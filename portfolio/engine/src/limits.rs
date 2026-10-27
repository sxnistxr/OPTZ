//! Memory-budget admission control.
//!
//! Every open TCP connection costs a fixed amount of unreclaimable kernel memory (socket, inode,
//! file and dentry slabs) plus our 64-byte slot. On a 2 GB box with no swap, accepting too many
//! means an OOM kill, which loses everything; refusing a connection loses one request. So:
//!
//! 1. a static ceiling computed at startup from MemTotal and the measured cost per connection;
//! 2. a dynamic floor: once a second, if MemAvailable drops below `FLOOR`, new connections are
//!    closed immediately until it recovers past `FLOOR + HYSTERESIS`.
//!
//! In a cgroup v2 with a memory limit (systemd's MemoryMax=), the limit is the box: MemTotal and
//! MemAvailable describe the host, but the kernel kills the service at memory.max. So both the
//! ceiling and the floor use the smaller of the two (available in the cgroup: memory.max minus
//! what it uses, not counting reclaimable page cache).
//!
//! /proc/meminfo and the cgroup files are opened once at startup and re-read with pread, so the
//! check never opens a file (and so can't fail with EMFILE when the process is out of descriptors).

use std::os::fd::{AsRawFd, OwnedFd};

/// Kernel + application memory per idle keep-alive connection, in bytes. Measured with
/// tests/connmem.py on Ubuntu 24.04 (kernel 6.8, 1 vCPU / 2 GB VPS), 40k and 80k connections:
/// ~4.0 KB of socket slab, plus 0.34-0.47 KB of io_uring request state (the armed multishot
/// recv), plus ~0.15 KB of our RSS: 4.5-4.6 KB. Rounded up for slack; see docs/MEASUREMENTS.md.
/// The dynamic floor below is the real safety net if this is off.
pub const PER_CONN: u64 = 4_800;
/// Memory kept back for the OS, page cache for SQLite's hot pages, our buffers and slack.
pub const RESERVE: u64 = 320 << 20;
pub const FLOOR: u64 = 96 << 20;
pub const HYSTERESIS: u64 = 32 << 20;

pub struct MemInfo {
    fd: Option<OwnedFd>,
    cgroup: Option<Cgroup>,
    buf: [u8; 4096],
}

/// The memory files of this process's cgroup (v2, or v1 on hybrid hosts), when it has a limit.
struct Cgroup {
    max: u64,
    current: OwnedFd,
    stat: OwnedFd,
    v1: bool,
}

fn pread_into(fd: &OwnedFd, buf: &mut [u8]) -> Option<usize> {
    let n = unsafe { libc::pread(fd.as_raw_fd(), buf.as_mut_ptr().cast(), buf.len(), 0) };
    (n > 0).then_some(n as usize)
}

/// This process's memory cgroup directory, from /proc/self/cgroup: v2's single "0::/path" line,
/// else v1's "N:memory:/path" (hybrid hosts). Returns the directory and whether it's v1.
fn cgroup_dir(proc_self_cgroup: &str, root: &str) -> Option<(String, bool)> {
    let v1 = proc_self_cgroup.lines().find_map(|l| l.split_once(":memory:").map(|(_, p)| p.trim()));
    let v2 = proc_self_cgroup.lines().find_map(|l| l.strip_prefix("0::")).map(str::trim);
    let v2dir = v2.map(|p| format!("{root}{}", p.trim_end_matches('/')));
    if let Some(d) = v2dir.filter(|d| std::path::Path::new(&format!("{d}/memory.max")).exists()) {
        return Some((d, false));
    }
    v1.map(|p| (format!("{root}/memory{}", p.trim_end_matches('/')), true))
}

/// memory.max / memory.limit_in_bytes: a byte count, or "max" / a near-2^63 value (no limit).
fn parse_limit(text: &[u8]) -> Option<u64> {
    std::str::from_utf8(text).ok()?.trim().parse().ok().filter(|&v: &u64| v < 1 << 60)
}

impl Cgroup {
    fn open(root: &str) -> Option<Cgroup> {
        let (dir, v1) = cgroup_dir(&std::fs::read_to_string("/proc/self/cgroup").ok()?, root)?;
        let (max, current) = if v1 { ("memory.limit_in_bytes", "memory.usage_in_bytes") } else { ("memory.max", "memory.current") };
        let max = parse_limit(&std::fs::read(format!("{dir}/{max}")).ok()?)?;
        let current = std::fs::File::open(format!("{dir}/{current}")).ok()?.into();
        let stat = std::fs::File::open(format!("{dir}/memory.stat")).ok()?.into();
        Some(Cgroup { max, current, stat, v1 })
    }

    /// Bytes the cgroup can still use: the limit minus usage, not counting page cache the kernel
    /// would reclaim first (inactive_file).
    fn available(&self, buf: &mut [u8]) -> Option<u64> {
        let n = pread_into(&self.current, buf)?;
        let current: u64 = std::str::from_utf8(&buf[..n]).ok()?.trim().parse().ok()?;
        let n = pread_into(&self.stat, buf)?;
        let key: &[u8] = if self.v1 { b"total_inactive_file " } else { b"inactive_file " };
        let reclaimable = parse_kb(&buf[..n], key).unwrap_or(0);
        Some(self.max.saturating_sub(current.saturating_sub(reclaimable)))
    }
}

impl MemInfo {
    pub fn open() -> MemInfo {
        let fd = std::fs::File::open("/proc/meminfo").ok().map(OwnedFd::from);
        MemInfo { fd, cgroup: Cgroup::open("/sys/fs/cgroup"), buf: [0; 4096] }
    }

    fn read_kb(&mut self, key: &[u8]) -> Option<u64> {
        let n = pread_into(self.fd.as_ref()?, &mut self.buf)?;
        parse_kb(&self.buf[..n], key)
    }

    /// The memory this process may use: the box's, or its cgroup's limit if smaller.
    pub fn total(&mut self) -> Option<u64> {
        let host = self.read_kb(b"MemTotal:").map(|k| k * 1024);
        match (&self.cgroup, host) {
            (Some(cg), Some(h)) => Some(h.min(cg.max)),
            (Some(cg), None) => Some(cg.max),
            (None, h) => h,
        }
    }

    pub fn available(&mut self) -> Option<u64> {
        let host = self.read_kb(b"MemAvailable:").map(|k| k * 1024);
        let cg = match &self.cgroup {
            Some(cg) => cg.available(&mut self.buf),
            None => None,
        };
        match (host, cg) {
            (Some(h), Some(c)) => Some(h.min(c)),
            (h, c) => h.or(c),
        }
    }

    /// The cgroup memory limit in force, if any (for the startup log).
    pub fn cgroup_limit(&self) -> Option<u64> {
        self.cgroup.as_ref().map(|c| c.max)
    }
}

fn parse_kb(text: &[u8], key: &[u8]) -> Option<u64> {
    let line = text.split(|&c| c == b'\n').find(|l| l.starts_with(key))?;
    let mut v: u64 = 0;
    let mut seen = false;
    for &c in line[key.len()..].iter().skip_while(|c| !c.is_ascii_digit()).take_while(|c| c.is_ascii_digit()) {
        v = v.checked_mul(10)?.checked_add((c - b'0') as u64)?;
        seen = true;
    }
    seen.then_some(v)
}

/// The static connection ceiling for a box with `mem_total` bytes.
pub fn ceiling(mem_total: u64) -> u64 {
    mem_total.saturating_sub(RESERVE) / PER_CONN
}

/// Tracks the dynamic floor with hysteresis.
pub struct Pressure {
    pub low: bool,
}

impl Pressure {
    pub fn update(&mut self, available: Option<u64>) {
        let Some(a) = available else { return };
        if self.low {
            if a > FLOOR + HYSTERESIS {
                self.low = false;
            }
        } else if a < FLOOR {
            self.low = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_meminfo() {
        let t = b"MemTotal:        2014208 kB\nMemFree:          100 kB\nMemAvailable:    1500000 kB\n";
        assert_eq!(parse_kb(t, b"MemTotal:"), Some(2014208));
        assert_eq!(parse_kb(t, b"MemAvailable:"), Some(1500000));
        assert_eq!(parse_kb(t, b"Nope:"), None);
        assert_eq!(ceiling(2014208 * 1024), (2014208 * 1024 - RESERVE) / PER_CONN);
    }

    #[test]
    fn reads_cgroup_v2() {
        // v1 (a hybrid host: the v2 line's directory has no memory.max here).
        assert_eq!(cgroup_dir("12:memory:/x/y\n0::/\n", "/nonexistent"), Some(("/nonexistent/memory/x/y".to_string(), true)));
        assert_eq!(cgroup_dir("0::/\n", "/nonexistent"), None);
        assert_eq!(parse_limit(b"1887436800\n"), Some(1_887_436_800));
        assert_eq!(parse_limit(b"max\n"), None);
        assert_eq!(parse_limit(b"9223372036854771712\n"), None);
        assert_eq!(parse_kb(b"anon 100\nfile 2000\ninactive_file 1500\n", b"inactive_file "), Some(1500));
        // The startup ceiling under MemoryMax=1800M on a 16 GB host follows the cgroup.
        assert!(ceiling(1_887_436_800) < 400_000);
    }

    #[test]
    fn hysteresis() {
        let mut p = Pressure { low: false };
        p.update(Some(FLOOR - 1));
        assert!(p.low);
        p.update(Some(FLOOR + 1));
        assert!(p.low);
        p.update(Some(FLOOR + HYSTERESIS + 1));
        assert!(!p.low);
    }
}
