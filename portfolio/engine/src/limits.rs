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
//! /proc/meminfo is opened once at startup and re-read with pread, so the check never opens a
//! file (and so can't fail with EMFILE when the process is out of descriptors).

use std::os::fd::{AsRawFd, OwnedFd};

/// Kernel + application memory per idle keep-alive connection, in bytes. Measured with
/// tests/connmem.py on Ubuntu 24.04 (kernel 6.8, 1 vCPU / 2 GB VPS), 40k and 80k connections:
/// ~4.0 KB of socket slab + 0.34-0.47 KB of io_uring request state (the armed multishot recv)
/// + ~0.15 KB of our RSS = 4.5-4.6 KB. Rounded up for slack; see docs/MEASUREMENTS.md.
/// The dynamic floor below is the real safety net if this is off.
pub const PER_CONN: u64 = 4_800;
/// Memory kept back for the OS, page cache for SQLite's hot pages, our buffers and slack.
pub const RESERVE: u64 = 320 << 20;
pub const FLOOR: u64 = 96 << 20;
pub const HYSTERESIS: u64 = 32 << 20;

pub struct MemInfo {
    fd: Option<OwnedFd>,
    buf: [u8; 4096],
}

impl MemInfo {
    pub fn open() -> MemInfo {
        let fd = std::fs::File::open("/proc/meminfo").ok().map(OwnedFd::from);
        MemInfo { fd, buf: [0; 4096] }
    }

    fn read_kb(&mut self, key: &[u8]) -> Option<u64> {
        let fd = self.fd.as_ref()?.as_raw_fd();
        let n = unsafe { libc::pread(fd, self.buf.as_mut_ptr().cast(), self.buf.len(), 0) };
        if n <= 0 {
            return None;
        }
        parse_kb(&self.buf[..n as usize], key)
    }

    pub fn total(&mut self) -> Option<u64> {
        self.read_kb(b"MemTotal:").map(|k| k * 1024)
    }

    pub fn available(&mut self) -> Option<u64> {
        self.read_kb(b"MemAvailable:").map(|k| k * 1024)
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
