//! $12 Server Challenge entry: Rust + raw io_uring + SQLite.
//!
//! Configured only by SQLITE_PATH, JWT_SECRET, HOST and PORT. Two threads: the network thread
//! (everything except writes) and the writer thread (the only read-write SQLite connection).

mod db;
mod handlers;
mod http;
mod json;
mod jwt;
mod limits;
mod net;
mod spsc;
mod sqlite;

use std::io;
use std::net::{SocketAddr, ToSocketAddrs};
use std::os::fd::RawFd;

/// Write jobs that may be in flight (queued or in a batch) at once.
const JOB_CAPACITY: usize = 8192;

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| {
        eprintln!("missing environment variable {name}");
        std::process::exit(2)
    })
}

fn cvt(r: libc::c_int) -> io::Result<libc::c_int> {
    if r < 0 { Err(io::Error::last_os_error()) } else { Ok(r) }
}

/// Raises the soft RLIMIT_NOFILE to the hard limit (allowed in-process) and returns it.
fn raise_nofile() -> u64 {
    let mut rl = libc::rlimit { rlim_cur: 0, rlim_max: 0 };
    unsafe {
        libc::getrlimit(libc::RLIMIT_NOFILE, &mut rl);
        rl.rlim_cur = rl.rlim_max;
        libc::setrlimit(libc::RLIMIT_NOFILE, &rl);
        libc::getrlimit(libc::RLIMIT_NOFILE, &mut rl);
    }
    rl.rlim_cur
}

fn setopt(fd: RawFd, level: libc::c_int, name: libc::c_int, v: libc::c_int) -> io::Result<()> {
    cvt(unsafe { libc::setsockopt(fd, level, name, (&v as *const libc::c_int).cast(), 4) }).map(drop)
}

/// The listening socket. Options set here are inherited by every accepted socket, which matters
/// because accepted sockets are io_uring direct descriptors that plain setsockopt can't reach.
fn listen(addr: SocketAddr) -> io::Result<RawFd> {
    let domain = if addr.is_ipv4() { libc::AF_INET } else { libc::AF_INET6 };
    let fd = cvt(unsafe { libc::socket(domain, libc::SOCK_STREAM | libc::SOCK_CLOEXEC, 0) })?;
    setopt(fd, libc::SOL_SOCKET, libc::SO_REUSEADDR, 1)?;
    // Responses are written in one send; without NODELAY the tail segment of a multi-segment
    // feed would wait on the client's delayed ACK.
    setopt(fd, libc::IPPROTO_TCP, libc::TCP_NODELAY, 1)?;
    let r = match addr {
        SocketAddr::V4(a) => {
            let sa = libc::sockaddr_in {
                sin_family: libc::AF_INET as u16,
                sin_port: a.port().to_be(),
                sin_addr: libc::in_addr { s_addr: u32::from(*a.ip()).to_be() },
                sin_zero: [0; 8],
            };
            unsafe { libc::bind(fd, (&sa as *const libc::sockaddr_in).cast(), size_of::<libc::sockaddr_in>() as u32) }
        }
        SocketAddr::V6(a) => {
            let sa = libc::sockaddr_in6 {
                sin6_family: libc::AF_INET6 as u16,
                sin6_port: a.port().to_be(),
                sin6_flowinfo: 0,
                sin6_addr: libc::in6_addr { s6_addr: a.ip().octets() },
                sin6_scope_id: a.scope_id(),
            };
            unsafe { libc::bind(fd, (&sa as *const libc::sockaddr_in6).cast(), size_of::<libc::sockaddr_in6>() as u32) }
        }
    };
    cvt(r)?;
    // The kernel caps this at net.core.somaxconn; ask for the most we could use.
    cvt(unsafe { libc::listen(fd, 65535) })?;
    Ok(fd)
}

/// Blocks SIGTERM/SIGINT (delivered via signalfd instead) and ignores SIGPIPE. Must run before
/// any thread is spawned so every thread inherits the mask.
fn signals() -> io::Result<RawFd> {
    unsafe {
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        libc::sigaddset(&mut set, libc::SIGTERM);
        libc::sigaddset(&mut set, libc::SIGINT);
        libc::pthread_sigmask(libc::SIG_BLOCK, &set, std::ptr::null_mut());
        libc::signal(libc::SIGPIPE, libc::SIG_IGN);
        cvt(libc::signalfd(-1, &set, libc::SFD_CLOEXEC))
    }
}

struct Args {
    shard_slots: Option<u32>,
    max_conns: Option<u64>,
}

/// Test-only overrides; start.sh passes none, so the server is configured by env vars alone.
fn args() -> Args {
    let mut a = Args { shard_slots: None, max_conns: None };
    for arg in std::env::args().skip(1) {
        if let Some(v) = arg.strip_prefix("--shard-slots=") {
            a.shard_slots = v.parse().ok();
        } else if let Some(v) = arg.strip_prefix("--max-conns=") {
            a.max_conns = v.parse().ok();
        } else {
            eprintln!("unknown argument {arg}");
            std::process::exit(2);
        }
    }
    a
}

fn main() {
    let a = args();
    let path = env("SQLITE_PATH");
    let secret = env("JWT_SECRET");
    // An empty secret makes every token forgeable; a short one, guessable.
    if secret.is_empty() {
        eprintln!("JWT_SECRET is empty");
        std::process::exit(2);
    }
    if secret.len() < 32 {
        eprintln!("warning: JWT_SECRET is {} bytes; use at least 32 random bytes", secret.len());
    }
    let host = env("HOST");
    let port = env("PORT");
    let addr = match (host.as_str(), port.parse::<u16>().unwrap_or(0)).to_socket_addrs().ok().and_then(|mut i| i.next()) {
        Some(a) => a,
        None => {
            eprintln!("bad HOST/PORT: {host}:{port}");
            std::process::exit(2);
        }
    };

    let sigfd = signals().expect("signalfd");
    let nofile = raise_nofile();
    let mut meminfo = limits::MemInfo::open();
    let mem_total = meminfo.total().unwrap_or(2 << 30);
    let max_conns = a.max_conns.unwrap_or_else(|| limits::ceiling(mem_total));
    let shard_slots = a.shard_slots.unwrap_or(nofile.min(65535) as u32);

    let reader = match db::read::Reader::open(&path) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("open {path}: {e}");
            std::process::exit(1);
        }
    };
    let efd = cvt(unsafe { libc::eventfd(0, libc::EFD_CLOEXEC) }).expect("eventfd");
    let notify = move || {
        let one: u64 = 1;
        unsafe { libc::write(efd, (&one as *const u64).cast(), 8) };
    };
    let (w, join) = match db::writer::spawn(&path, JOB_CAPACITY, notify) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("open writer {path}: {e}");
            std::process::exit(1);
        }
    };
    let listen_fd = match listen(addr) {
        Ok(fd) => fd,
        Err(e) => {
            eprintln!("listen {addr}: {e}");
            std::process::exit(1);
        }
    };
    let ctx = handlers::Ctx { reader, jwt: jwt::Verifier::new(secret.as_bytes()), started: std::time::Instant::now() };
    let signal = w.signal.clone();
    let cfg = net::Config { listen_fd, shard_slots, max_shards: net::MAX_SHARDS, max_conns, eventfd: efd, signalfd: sigfd };
    let mut server = match net::Server::new(cfg, ctx, w, JOB_CAPACITY) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("io_uring setup: {e}");
            std::process::exit(1);
        }
    };
    eprintln!(
        "listening on {addr}: {shard_slots} slots/shard x {} shards, connection ceiling {max_conns} (memory {} MiB{})",
        net::MAX_SHARDS,
        mem_total >> 20,
        if meminfo.cgroup_limit().is_some_and(|l| l <= mem_total) { ", the cgroup's limit" } else { "" }
    );
    let r = server.run();
    // Stop the writer: it finishes queued jobs, checkpoints the WAL (TRUNCATE) and closes.
    signal.stop.store(true, std::sync::atomic::Ordering::SeqCst);
    signal.thread.unpark();
    let _ = join.join();
    eprintln!("stopped: {:?}, {} requests", server.stats, server.requests());
    if let Err(e) = r {
        eprintln!("event loop: {e}");
        std::process::exit(1);
    }
}
