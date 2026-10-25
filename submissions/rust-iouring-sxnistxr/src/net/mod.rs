//! The network thread: io_uring event loop, connection table, and request dispatch.
//!
//! Sockets are io_uring *direct descriptors* in each ring's fixed-file table, not process fds,
//! so the 65,535 RLIMIT_NOFILE doesn't cap connections. A table can't exceed RLIMIT_NOFILE
//! slots, so connections are sharded over up to `MAX_SHARDS` rings, all driven by this one
//! thread. Shard 0 is the ring we block on; it also carries the writer's eventfd, the signalfd,
//! the 1 s timer and a multishot poll on every other shard's ring fd, so a completion on any
//! shard wakes us.
//!
//! Per connection there is at most one operation of each kind in flight: one multishot recv,
//! one send. A connection handles one request at a time; pipelined bytes wait in a stash.
//! Close is deferred until both are finished, so a slot is never reused while the kernel still
//! has an operation on it, and generations in `user_data` reject stale completions anyway.

mod bufring;

use crate::db::writer::{self, Job};
use crate::handlers::{self, Action, Ctx};
use crate::http::{self, Parse};
use crate::limits::{self, MemInfo, Pressure};
use bufring::BufRing;
use io_uring::types::{CancelBuilder, Fd, Fixed, TimeoutFlags, Timespec};
use io_uring::{IoUring, cqueue, opcode, squeue};
use std::collections::VecDeque;
use std::io;
use std::os::fd::RawFd;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub const MAX_SHARDS: usize = 8;
const SQ_ENTRIES: u32 = 4096;
const CQ_ENTRIES: u32 = 16384;
const RECV_BUFS: u16 = 2048;
const RECV_BUF_SIZE: usize = 2048;
const CQE_BATCH: usize = 1024;
/// Single-shot accepts kept in flight.
const ACCEPT_DEPTH: u32 = 16;
/// Shut down connections stalled mid-request or mid-send for this long.
const STALL_SECS: u32 = 120;
/// Reusable response buffers kept around; bigger or extra ones are freed.
const OUT_POOL_MAX: usize = 4096;
const OUT_KEEP_CAPACITY: usize = 16 * 1024;
/// Close a connection whose unprocessed (pipelined or partial) input exceeds this.
const STASH_MAX: usize = http::MAX_REQUEST + RECV_BUF_SIZE;
/// Give in-flight work this long to finish after SIGTERM.
const DRAIN_SECS: u64 = 5;

// user_data layout: op (8 bits) | shard (8) | slot (16) | generation (32).
const OP_ACCEPT: u64 = 1;
const OP_RECV: u64 = 2;
const OP_SEND: u64 = 3;
const OP_CLOSE: u64 = 4;
const OP_CANCEL: u64 = 5;
const OP_EVENTFD: u64 = 6;
const OP_TIMER: u64 = 7;
const OP_SIGNAL: u64 = 8;
const OP_POLL: u64 = 9;

#[inline]
fn ud(op: u64, shard: usize, slot: u32, gen_: u32) -> u64 {
    op << 56 | (shard as u64) << 48 | (slot as u64) << 32 | gen_ as u64
}

#[inline]
fn split(u: u64) -> (u64, usize, u32, u32) {
    (u >> 56, (u >> 48 & 0xFF) as usize, (u >> 32 & 0xFFFF) as u32, u as u32)
}

#[derive(Clone, Copy, PartialEq, Debug, Default)]
enum State {
    #[default]
    Free,
    Open,
    /// Waiting for in-flight ops to finish before closing.
    Closing,
    /// Close submitted.
    Closed,
}

struct Out {
    buf: Vec<u8>,
    pos: usize,
    end: usize,
}

/// One connection slot. Idle connections own nothing but this.
#[derive(Default)]
struct Conn {
    gen_: u32,
    state: State,
    recv_armed: bool,
    sending: bool,
    /// A write job for this connection is with the writer.
    waiting: bool,
    close_after: bool,
    /// Coarse second when the connection started holding a partial request or a pending send.
    stalled_since: u32,
    input: Option<Box<Vec<u8>>>,
    out: Option<Box<Out>>,
}

impl Conn {
    fn busy(&self) -> bool {
        self.sending || self.waiting
    }
}

/// A shard's ring and connections, borrowed separately from its receive buffers so a buffer's
/// bytes can be handled while connections are updated.
struct Io {
    ring: IoUring,
    conns: Vec<Conn>,
    live: u32,
    /// Accepts in flight on this shard; each has a slot reserved.
    accepts: u32,
    slots: u32,
    sweep_at: usize,
}

struct Shard {
    // `io` (the ring) first: it must be torn down before the buffer memory it references.
    io: Io,
    bufs: BufRing,
}

pub struct Config {
    pub listen_fd: RawFd,
    /// Fixed-file slots per shard (capped by RLIMIT_NOFILE).
    pub shard_slots: u32,
    pub max_shards: usize,
    /// Static connection ceiling from the memory budget.
    pub max_conns: u64,
    pub eventfd: RawFd,
    pub signalfd: RawFd,
}

struct Jobs {
    tx: crate::spsc::Producer<Job>,
    overflow: VecDeque<Job>,
    in_flight: usize,
    cap: usize,
    pushed: bool,
}

impl Jobs {
    fn push(&mut self, job: Job) {
        if self.overflow.is_empty() && self.in_flight < self.cap {
            match self.tx.push(job) {
                Ok(()) => {
                    self.in_flight += 1;
                    self.pushed = true;
                }
                Err(job) => self.overflow.push_back(job),
            }
        } else {
            self.overflow.push_back(job);
        }
    }

    fn flush(&mut self) {
        while self.in_flight < self.cap {
            let Some(job) = self.overflow.pop_front() else { break };
            match self.tx.push(job) {
                Ok(()) => {
                    self.in_flight += 1;
                    self.pushed = true;
                }
                Err(job) => {
                    self.overflow.push_front(job);
                    break;
                }
            }
        }
    }
}

/// Everything request handling needs besides the shard. Split out so a shard's ring, buffers
/// and connections can be borrowed alongside it.
struct Env {
    ctx: Ctx,
    jobs: Jobs,
    pool: Vec<Box<Out>>,
    now_unix: i64,
    now_coarse: u32,
    sends_in_flight: usize,
    requests: u64,
}

impl Env {
    fn take_out(&mut self) -> Box<Out> {
        let mut o = self.pool.pop().unwrap_or_else(|| Box::new(Out { buf: Vec::with_capacity(8192), pos: 0, end: 0 }));
        http::begin(&mut o.buf);
        o
    }

    fn give_out(&mut self, o: Box<Out>) {
        if self.pool.len() < OUT_POOL_MAX && o.buf.capacity() <= OUT_KEEP_CAPACITY {
            self.pool.push(o);
        }
    }
}

pub struct Server {
    shards: Vec<Shard>,
    env: Env,
    cfg: Config,
    replies: crate::spsc::Consumer<writer::Reply>,
    signal: std::sync::Arc<writer::Signal>,
    /// Accepts in flight, across all shards.
    accepts: u32,
    /// Accept stopped because every shard is full or accept failed; retried on close/tick.
    accept_paused: bool,
    total_conns: u64,
    pressure: Pressure,
    meminfo: MemInfo,
    rearm: Vec<(usize, u32)>,
    timer: Box<Timespec>,
    efd_buf: Box<u64>,
    sig_buf: Box<[u8; 128]>,
    draining: Option<Instant>,
    started: Instant,
    pub stats: Stats,
}

#[derive(Default, Debug)]
pub struct Stats {
    pub accepted: u64,
    pub refused: u64,
    pub accept_errors: u64,
}

#[inline]
fn push(ring: &mut IoUring, e: &squeue::Entry) {
    // SAFETY: every buffer an SQE points to (response buffers, the timer, eventfd and signalfd
    // buffers) is heap-allocated and owned until its completion is reaped.
    unsafe {
        while ring.submission().push(e).is_err() {
            let _ = ring.submit();
        }
    }
}

fn new_ring() -> io::Result<IoUring> {
    IoUring::builder()
        .setup_single_issuer()
        .setup_coop_taskrun()
        .setup_taskrun_flag()
        .setup_submit_all()
        .setup_cqsize(CQ_ENTRIES)
        .build(SQ_ENTRIES)
}

impl Server {
    pub fn new(cfg: Config, ctx: Ctx, w: writer::Handle, capacity: usize) -> io::Result<Server> {
        let writer::Handle { signal, jobs, replies } = w;
        let mut s = Server {
            shards: Vec::new(),
            env: Env {
                ctx,
                jobs: Jobs { tx: jobs, overflow: VecDeque::new(), in_flight: 0, cap: capacity, pushed: false },
                pool: Vec::new(),
                now_unix: 0,
                now_coarse: 0,
                sends_in_flight: 0,
                requests: 0,
            },
            cfg,
            replies,
            signal,
            accepts: 0,
            accept_paused: false,
            total_conns: 0,
            pressure: Pressure { low: false },
            meminfo: MemInfo::open(),
            rearm: Vec::new(),
            timer: Box::new(Timespec::new().sec(1)),
            efd_buf: Box::new(0),
            sig_buf: Box::new([0; 128]),
            draining: None,
            started: Instant::now(),
            stats: Stats::default(),
        };
        s.add_shard()?;
        s.arm_timer();
        s.arm_eventfd();
        s.arm_signal();
        s.fill_accepts();
        Ok(s)
    }

    fn add_shard(&mut self) -> io::Result<usize> {
        let idx = self.shards.len();
        let ring = new_ring()?;
        ring.submitter().register_files_sparse(self.cfg.shard_slots)?;
        let bufs = BufRing::new(&ring.submitter(), 0, RECV_BUFS, RECV_BUF_SIZE)?;
        let fd = ring.as_raw_fd_compat();
        self.shards.push(Shard { io: Io { ring, conns: Vec::new(), live: 0, accepts: 0, slots: self.cfg.shard_slots, sweep_at: 0 }, bufs });
        if idx > 0 {
            self.arm_poll(idx, fd);
        }
        Ok(idx)
    }

    fn arm_poll(&mut self, shard: usize, fd: RawFd) {
        let e = opcode::PollAdd::new(Fd(fd), libc::POLLIN as u32).multi(true).build().user_data(ud(OP_POLL, shard, 0, 0));
        push(&mut self.shards[0].io.ring, &e);
    }

    fn arm_timer(&mut self) {
        let timer: *const Timespec = &*self.timer;
        let e = opcode::Timeout::new(timer).flags(TimeoutFlags::MULTISHOT).build().user_data(ud(OP_TIMER, 0, 0, 0));
        push(&mut self.shards[0].io.ring, &e);
    }

    fn arm_eventfd(&mut self) {
        let p: *mut u64 = &mut *self.efd_buf;
        let e = opcode::Read::new(Fd(self.cfg.eventfd), p.cast(), 8).build().user_data(ud(OP_EVENTFD, 0, 0, 0));
        push(&mut self.shards[0].io.ring, &e);
    }

    fn arm_signal(&mut self) {
        let p: *mut [u8; 128] = &mut *self.sig_buf;
        let e = opcode::Read::new(Fd(self.cfg.signalfd), p.cast(), 128).build().user_data(ud(OP_SIGNAL, 0, 0, 0));
        push(&mut self.shards[0].io.ring, &e);
    }

    /// Keeps `ACCEPT_DEPTH` single-shot accepts in flight, each on a shard with a free slot
    /// reserved for it.
    ///
    /// Not multishot: when a fixed-file table is full the kernel has already accepted the TCP
    /// connection and then drops it, and a multishot accept can't be stopped at an exact count
    /// (it drains the whole backlog per wakeup). Counting single-shot accepts against free slots
    /// means a table never overflows. Accepts are per connection, not per request, so the extra
    /// SQEs cost little.
    fn fill_accepts(&mut self) {
        if self.draining.is_some() || self.accept_paused {
            return;
        }
        while self.accepts < ACCEPT_DEPTH {
            let shard = match self.shards.iter().position(|s| s.io.live + s.io.accepts < s.io.slots) {
                Some(i) => i,
                None if self.shards.len() < self.cfg.max_shards => match self.add_shard() {
                    Ok(i) => i,
                    Err(e) => {
                        eprintln!("net: can't add shard: {e}");
                        self.accept_paused = true;
                        return;
                    }
                },
                // Every slot is taken: resume when a connection closes.
                None => return,
            };
            // No SOCK_CLOEXEC: direct descriptors aren't process fds (the kernel rejects it).
            let e = opcode::Accept::new(Fd(self.cfg.listen_fd), std::ptr::null_mut(), std::ptr::null_mut())
                .file_index(Some(io_uring::types::DestinationSlot::auto_target()))
                .build()
                .user_data(ud(OP_ACCEPT, shard, 0, 0));
            push(&mut self.shards[shard].io.ring, &e);
            self.shards[shard].io.accepts += 1;
            self.accepts += 1;
        }
    }

    pub fn requests(&self) -> u64 {
        self.env.requests
    }

    pub fn run(&mut self) -> io::Result<()> {
        let mut cqes: Vec<(u64, i32, u32)> = Vec::with_capacity(CQE_BATCH);
        loop {
            let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
            self.env.now_unix = now;
            self.env.now_coarse = self.started.elapsed().as_secs() as u32 + 1;

            let mut any = false;
            for s in 0..self.shards.len() {
                cqes.clear();
                for e in self.shards[s].io.ring.completion() {
                    cqes.push((e.user_data(), e.result(), e.flags()));
                    if cqes.len() == CQE_BATCH {
                        break;
                    }
                }
                any |= !cqes.is_empty();
                for &(u, res, flags) in &cqes {
                    self.on_cqe(u, res, flags);
                }
            }
            for sh in &mut self.shards {
                sh.bufs.commit();
            }
            for (s, slot) in std::mem::take(&mut self.rearm) {
                let c = &mut self.shards[s].io.conns[slot as usize];
                if c.state == State::Open && !c.recv_armed {
                    arm_recv(&mut self.shards[s].io, s, slot);
                }
            }
            self.env.ctx.reader.end_batch();
            self.env.jobs.flush();
            if std::mem::take(&mut self.env.jobs.pushed) {
                self.signal.wake();
            }
            if let Some(since) = self.draining {
                let idle = self.env.jobs.in_flight == 0 && self.env.jobs.overflow.is_empty() && self.env.sends_in_flight == 0;
                if idle || since.elapsed().as_secs() >= DRAIN_SECS {
                    return Ok(());
                }
            }
            for s in 1..self.shards.len() {
                let r = &mut self.shards[s].io.ring;
                if !r.submission().is_empty() || r.submission().taskrun() {
                    r.submit()?;
                }
            }
            let r = &mut self.shards[0].io.ring;
            let res = if any { r.submit() } else { r.submit_and_wait(1) };
            match res {
                Ok(_) => {}
                Err(e) if e.raw_os_error() == Some(libc::EINTR) || e.raw_os_error() == Some(libc::EBUSY) => {}
                Err(e) => return Err(e),
            }
        }
    }

    fn on_cqe(&mut self, u: u64, res: i32, flags: u32) {
        let (op, s, slot, gen_) = split(u);
        match op {
            OP_ACCEPT => self.on_accept(s, res),
            OP_RECV => self.on_recv(s, slot, gen_, res, flags),
            OP_SEND => self.on_send(s, slot, gen_, res),
            OP_CLOSE => self.on_closed(s, slot),
            OP_CANCEL => {}
            OP_EVENTFD => {
                self.on_replies();
                self.arm_eventfd();
            }
            OP_TIMER => {
                self.tick();
                if !cqueue::more(flags) {
                    self.arm_timer();
                }
            }
            OP_SIGNAL => {
                if res > 0 {
                    self.begin_drain();
                } else {
                    self.arm_signal();
                }
            }
            OP_POLL => {
                if !cqueue::more(flags) {
                    let fd = self.shards[s].io.ring.as_raw_fd_compat();
                    self.arm_poll(s, fd);
                }
            }
            _ => {}
        }
    }

    fn begin_drain(&mut self) {
        if self.draining.is_some() {
            return;
        }
        eprintln!("shutting down: draining in-flight requests");
        self.draining = Some(Instant::now());
        for s in 0..self.shards.len() {
            if self.shards[s].io.accepts > 0 {
                let e = opcode::AsyncCancel2::new(CancelBuilder::user_data(ud(OP_ACCEPT, s, 0, 0)).all())
                    .build()
                    .user_data(ud(OP_CANCEL, s, 0, 0));
                push(&mut self.shards[s].io.ring, &e);
            }
        }
    }

    fn on_accept(&mut self, s: usize, res: i32) {
        self.shards[s].io.accepts -= 1;
        self.accepts -= 1;
        if res < 0 {
            match -res {
                libc::ECANCELED => {}
                // Anything else (ENFILE, EMFILE, ENOMEM, ...): retry on the next tick, never spin.
                e => {
                    if self.stats.accept_errors < 10 {
                        eprintln!("net: accept failed: {}", io::Error::from_raw_os_error(e));
                    }
                    self.stats.accept_errors += 1;
                    self.accept_paused = true;
                }
            }
            return;
        }
        let slot = res as u32;
        self.stats.accepted += 1;
        self.total_conns += 1;
        let sh = &mut self.shards[s].io;
        sh.live += 1;
        if sh.conns.len() <= slot as usize {
            let want = (slot as usize + 1).next_power_of_two().min(sh.slots as usize).max(slot as usize + 1);
            sh.conns.resize_with(want, Conn::default);
        }
        let c = &mut sh.conns[slot as usize];
        c.gen_ = c.gen_.wrapping_add(1);
        c.state = State::Open;
        c.recv_armed = false;
        c.sending = false;
        c.waiting = false;
        c.close_after = false;
        c.stalled_since = 0;
        let admit = self.total_conns <= self.cfg.max_conns && !self.pressure.low && self.draining.is_none();
        if admit {
            arm_recv(sh, s, slot);
        } else {
            // Refusing a connection costs one request; running out of memory costs everything.
            self.stats.refused += 1;
            start_close(sh, &mut self.env, s, slot);
        }
        self.fill_accepts();
    }

    fn on_recv(&mut self, s: usize, slot: u32, gen_: u32, res: i32, flags: u32) {
        let more = cqueue::more(flags);
        let Shard { io: sh, bufs } = &mut self.shards[s];
        let Some(c) = sh.conns.get_mut(slot as usize) else { return };
        let current = c.gen_ == gen_;
        if current && !more {
            c.recv_armed = false;
        }
        let open = current && c.state == State::Open;
        if res > 0 {
            let bid = cqueue::buffer_select(flags).expect("recv with buffer select");
            if open {
                let data = bufs.get(bid, res as usize);
                on_data(sh, &mut self.env, s, slot, data);
            }
            bufs.push(bid);
        } else if open {
            if res == -libc::ENOBUFS {
                // Out of receive buffers; re-arm after this iteration returns some.
                if !more {
                    self.rearm.push((s, slot));
                }
                return;
            }
            // EOF (0) or an error: the peer is gone.
            start_close(sh, &mut self.env, s, slot);
        }
        let c = &mut sh.conns[slot as usize];
        if current && c.state == State::Open && !c.recv_armed {
            arm_recv(sh, s, slot);
        } else if current && c.state == State::Closing {
            finish_close(sh, &mut self.env, s, slot);
        }
    }

    fn on_send(&mut self, s: usize, slot: u32, gen_: u32, res: i32) {
        self.env.sends_in_flight -= 1;
        let sh = &mut self.shards[s].io;
        let c = &mut sh.conns[slot as usize];
        debug_assert_eq!(c.gen_, gen_);
        c.sending = false;
        if c.state != State::Open || res <= 0 {
            if let Some(o) = c.out.take() {
                self.env.give_out(o);
            }
            if c.state == State::Open {
                start_close(sh, &mut self.env, s, slot);
            } else {
                finish_close(sh, &mut self.env, s, slot);
            }
            return;
        }
        let o = c.out.as_mut().expect("send without buffer");
        o.pos += res as usize;
        if o.pos < o.end {
            submit_send(sh, &mut self.env, s, slot);
            return;
        }
        let o = c.out.take().unwrap();
        self.env.give_out(o);
        c.stalled_since = 0;
        if c.close_after {
            start_close(sh, &mut self.env, s, slot);
        } else if c.input.is_some() {
            drain_stash(sh, &mut self.env, s, slot);
        }
    }

    fn on_closed(&mut self, s: usize, slot: u32) {
        let sh = &mut self.shards[s].io;
        let c = &mut sh.conns[slot as usize];
        c.state = State::Free;
        sh.live -= 1;
        self.total_conns -= 1;
        self.fill_accepts();
    }

    fn on_replies(&mut self) {
        while let Some(reply) = self.replies.pop() {
            self.env.jobs.in_flight -= 1;
            let (_, s, slot, gen_) = split(reply.conn);
            let sh = &mut self.shards[s].io;
            let c = &mut sh.conns[slot as usize];
            if c.gen_ != gen_ || c.state != State::Open || !c.waiting {
                continue;
            }
            c.waiting = false;
            let mut o = self.env.take_out();
            let status = handlers::write_reply(&reply, &mut o.buf);
            let close = c.close_after;
            start_send(sh, &mut self.env, s, slot, o, status, close);
        }
    }

    fn tick(&mut self) {
        let avail = self.meminfo.available();
        let was_low = self.pressure.low;
        self.pressure.update(avail);
        if self.pressure.low && !was_low {
            eprintln!("net: MemAvailable below {} MiB: refusing new connections", limits::FLOOR >> 20);
        } else if was_low && !self.pressure.low {
            eprintln!("net: memory recovered: accepting connections");
        }
        self.accept_paused = false;
        self.fill_accepts();
        // Incremental sweep: each tick checks 1/16 of every shard's table for stalled partial
        // requests or sends, so idle connections cost nothing and the scan stays sub-millisecond.
        let now = self.env.now_coarse;
        for s in 0..self.shards.len() {
            let sh = &mut self.shards[s].io;
            let n = sh.conns.len();
            if n == 0 {
                continue;
            }
            let step = n.div_ceil(16);
            let from = sh.sweep_at % n;
            let to = (from + step).min(n);
            sh.sweep_at = if to == n { 0 } else { to };
            for slot in from..to {
                let c = &sh.conns[slot];
                if c.state == State::Open && c.stalled_since != 0 && now.saturating_sub(c.stalled_since) > STALL_SECS {
                    start_close(sh, &mut self.env, s, slot as u32);
                }
            }
        }
    }
}

fn arm_recv(sh: &mut Io, s: usize, slot: u32) {
    let c = &mut sh.conns[slot as usize];
    c.recv_armed = true;
    let e = opcode::RecvMulti::new(Fixed(slot), 0).build().user_data(ud(OP_RECV, s, slot, c.gen_));
    push(&mut sh.ring, &e);
}

/// New bytes for an open connection.
fn on_data(sh: &mut Io, env: &mut Env, s: usize, slot: u32, data: &[u8]) {
    let c = &mut sh.conns[slot as usize];
    if c.input.is_some() || c.busy() {
        let stashed = c.input.as_ref().map_or(0, |i| i.len());
        if stashed + data.len() > STASH_MAX {
            start_close(sh, env, s, slot);
            return;
        }
        c.input.get_or_insert_with(|| Box::new(Vec::with_capacity(data.len().max(1024)))).extend_from_slice(data);
        if c.stalled_since == 0 {
            c.stalled_since = env.now_coarse;
        }
        if !c.busy() {
            drain_stash(sh, env, s, slot);
        }
        return;
    }
    let n = process(sh, env, s, slot, data);
    let c = &mut sh.conns[slot as usize];
    if c.state == State::Open && n < data.len() {
        c.input = Some(Box::new(data[n..].to_vec()));
        if c.stalled_since == 0 {
            c.stalled_since = env.now_coarse;
        }
    }
}

/// Processes stashed input while the connection is idle.
fn drain_stash(sh: &mut Io, env: &mut Env, s: usize, slot: u32) {
    loop {
        let c = &mut sh.conns[slot as usize];
        if c.busy() || c.state != State::Open {
            return;
        }
        let Some(mut input) = c.input.take() else { return };
        let n = process(sh, env, s, slot, &input);
        let c = &mut sh.conns[slot as usize];
        input.drain(..n);
        if !input.is_empty() && c.state == State::Open {
            c.input = Some(input);
        }
        if n == 0 {
            return;
        }
    }
}

/// Parses and handles at most one request from `data`. Returns the bytes consumed.
fn process(sh: &mut Io, env: &mut Env, s: usize, slot: u32, data: &[u8]) -> usize {
    match http::parse(data) {
        Parse::Partial => 0,
        Parse::Bad(status) => {
            let mut o = env.take_out();
            o.buf.extend_from_slice(if status == 413 { b"{\"error\":\"request too large\"}" } else { b"{\"error\":\"bad request\"}" });
            start_send(sh, env, s, slot, o, status, true);
            data.len()
        }
        Parse::Done(req, n) => {
            env.requests += 1;
            let mut o = env.take_out();
            let gen_ = sh.conns[slot as usize].gen_;
            match handlers::handle(&mut env.ctx, &req, &mut o.buf, env.now_unix) {
                Action::Respond(status) => start_send(sh, env, s, slot, o, status, req.close),
                Action::Write(kind) => {
                    env.give_out(o);
                    let c = &mut sh.conns[slot as usize];
                    c.waiting = true;
                    c.close_after = req.close;
                    env.jobs.push(Job { conn: ud(0, s, slot, gen_), kind });
                }
            }
            let c = &mut sh.conns[slot as usize];
            if n == data.len() {
                c.stalled_since = 0;
            }
            n
        }
    }
}

fn start_send(sh: &mut Io, env: &mut Env, s: usize, slot: u32, mut o: Box<Out>, status: u16, close: bool) {
    o.pos = http::finish(&mut o.buf, status, close);
    o.end = o.buf.len();
    let c = &mut sh.conns[slot as usize];
    c.close_after |= close;
    c.out = Some(o);
    submit_send(sh, env, s, slot);
}

fn submit_send(sh: &mut Io, env: &mut Env, s: usize, slot: u32) {
    let c = &mut sh.conns[slot as usize];
    let o = c.out.as_ref().unwrap();
    c.sending = true;
    if c.stalled_since == 0 {
        c.stalled_since = env.now_coarse;
    }
    env.sends_in_flight += 1;
    let e = opcode::Send::new(Fixed(slot), o.buf[o.pos..].as_ptr(), (o.end - o.pos) as u32)
        .flags(libc::MSG_NOSIGNAL)
        .build()
        .user_data(ud(OP_SEND, s, slot, c.gen_));
    push(&mut sh.ring, &e);
}

fn start_close(sh: &mut Io, env: &mut Env, s: usize, slot: u32) {
    let c = &mut sh.conns[slot as usize];
    if c.state != State::Open {
        return;
    }
    c.state = State::Closing;
    c.input = None;
    if c.recv_armed {
        let e = opcode::AsyncCancel2::new(CancelBuilder::fd(Fixed(slot)).all()).build().user_data(ud(OP_CANCEL, s, slot, c.gen_));
        push(&mut sh.ring, &e);
    }
    finish_close(sh, env, s, slot);
}

/// Submits the close once no operation on the slot is in flight.
fn finish_close(sh: &mut Io, env: &mut Env, s: usize, slot: u32) {
    let c = &mut sh.conns[slot as usize];
    if c.state != State::Closing || c.recv_armed || c.sending {
        return;
    }
    if let Some(o) = c.out.take() {
        env.give_out(o);
    }
    c.state = State::Closed;
    let e = opcode::Close::new(Fixed(slot)).build().user_data(ud(OP_CLOSE, s, slot, c.gen_));
    push(&mut sh.ring, &e);
}

trait RawFdCompat {
    fn as_raw_fd_compat(&self) -> RawFd;
}

impl RawFdCompat for IoUring {
    fn as_raw_fd_compat(&self) -> RawFd {
        use std::os::fd::AsRawFd;
        self.as_raw_fd()
    }
}
