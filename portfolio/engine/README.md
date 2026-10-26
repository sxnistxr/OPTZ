# Rust + raw io_uring + SQLite

*Lives in `portfolio/engine/` in this repo, where it serves the portfolio's social feed;
`submissions/rust-iouring-sxnistxr` links here. Copy this folder as-is for a challenge PR.*

**Direct on `0.0.0.0:80`, no Nginx.** The server handles every keep-alive connection itself.

| | |
|---|---|
| Language | Rust 1.99.1 (stable, edition 2024), installed from the official standalone tarball, SHA-256 pinned in `install.sh` (no rustup, nothing piped to a shell) |
| Database | SQLite 3.54.1, official amalgamation built from source, SHA-256 pinned in `build.sh` |
| I/O | `io-uring` 0.7.15 (raw io_uring: no async runtime, no HTTP framework) |
| Other crates | `libc` 0.2.191, `httparse` 1.10.1, `sha2` 0.11.1 + `hmac` 0.13.0. Dev-only: `serde_json` 1.0.154, for differential tests. Exact pins in `Cargo.toml`, checksums in `Cargo.lock` |
| Kernel | Linux ≥ 6.4 (multishot timeouts); built and tested on 6.18, and on Ubuntu 24.04's 6.8 via the VPS |

```sh
sudo bash install.sh        # once, as root
bash build.sh               # as a normal user
SQLITE_PATH=... JWT_SECRET=... HOST=0.0.0.0 PORT=80 bash start.sh   # foreground
```

`start.sh` is a single `exec`. It never restarts the server itself, so systemd sees every crash.
The server reads only the four variables in SPEC.md.

## Architecture

Two threads, sized for one vCPU:

- **Network thread.** Accept, receive, HTTP parsing, JWT verification, every read query,
  response formatting and send, all driven by io_uring.
  - Sockets are io_uring *direct descriptors* in each ring's fixed-file table, not process fds,
    so `LimitNOFILE=65535` doesn't cap connections. A table can't exceed RLIMIT_NOFILE, so
    connections spill over up to 8 rings (524,280 slots), all driven by the same thread. Ring 0
    holds a multishot poll on every other ring's fd.
  - Receives are multishot with a provided-buffer ring: an idle connection owns no buffer, just
    a 32-byte slot.
- **Writer thread.** Owns the only read-write SQLite connection. Write jobs arrive over a
  lock-free SPSC queue. The writer drains everything pending into one `BEGIN IMMEDIATE`
  transaction and commits (`synchronous=FULL`: the WAL is fsynced). Only then are the results
  handed back (SPSC queue + eventfd watched by io_uring) and the 201/200 replies sent.

Reads use a separate connection, so a read can never see an uncommitted write. Reads within one
event-loop batch share one read transaction, and the loop ends it before waiting. A client only
sends its next request after receiving its reply, and that reply was sent after commit, so it
always sees its own writes. The pipelined create-then-feed test checks this.

## Optimizations, and why

Every number below was measured. The full log, including rejected ideas, is in
[BENCHMARKS.md](BENCHMARKS.md). Local numbers come from a 4 vCPU Xeon with the server pinned to
one CPU, over loopback. They're for before/after comparisons, not capacity claims.

1. **`SQLITE_ENABLE_QPSG` (query planner stability).** perf found SQL being *re-parsed* on every
   single-post request: SQLite marked the statement for re-planning whenever `?1` changed. With
   plans fixed at prepare time: **47.8k → ~108k req/s** for single posts (18.4 → 9.1 µs), and the
   mixed workload 32.7k → ~45k. A test asserts zero re-prepares.
2. **Feed range path.** The newest 20 ids are almost always 20 consecutive ids. One rowid range
   scan fetches the rows, and one covering scan of `likes_post_id_idx` is counted in Rust. That
   costs 14.2–14.6 µs per feed vs 19.7–20.4 µs for the reference query. Counting in Rust beat
   `GROUP BY` (8.0 µs) and 20 point counts (10.2 µs). Sparse spans, or a row with a missing
   author, fall back to the exact query, and a test asserts both paths produce identical bytes.
3. **Responses written straight into the send buffer.** Header space is reserved first, the
   body written after, and `Content-Length` filled in at the end, so there's no second pass and
   no per-request allocation on the read path.
4. **Word-at-a-time JSON escaping.** It checks 8 bytes per step and only inspects bytes in a
   word that needs escaping (~3 % on feed).
5. **Single-shot accepts, counted against free slots.** With multishot accept, a full
   fixed-file table made the kernel accept and then *drop* a connection (measured: 4 lost out of
   5,000 when spilling across shards). Keeping 16 single-shot accepts in flight, each with a slot
   reserved, means a table never overflows.
6. **Group commit + one statement per like.** `INSERT … SELECT … WHERE EXISTS … ON CONFLICT DO
   NOTHING` handles the common case in one statement; `changes()` tells 201 from 200/404.
7. **SQLite PGO on synthetic data.** `build.sh` profiles SQLite on a randomly generated
   database (never the seed) and rebuilds it: feed −7 %, mixed −5 to −12 % in every A/B pair.
   It falls back to the plain build if any step fails; `bash build.sh --no-pgo` skips it.
8. **Memory-budget admission control.** The connection ceiling comes from MemTotal and the
   *measured* cost per idle connection (~3.6–4.9 KB of kernel + app memory), plus a
   once-a-second MemAvailable floor read with `pread` on an fd opened at startup. Past either,
   new connections are closed at once. A refused connection costs one request; an OOM kill costs
   the run.

Rejected after measurement (details in BENCHMARKS.md): adaptive completion batching, fixed
`SO_RCVBUF`/`SO_SNDBUF`, fetching feed rows via the created_at index walk.

## Rules

- SQLite only, in-process, on `$SQLITE_PATH`. Schema untouched.
- No caching across requests: every request reads SQLite while it's served, and every JWT
  signature is verified. Only the HMAC key schedule is precomputed from the secret.
- Writes are durable before responding: WAL + `synchronous=FULL`, group commit, no reply before
  `COMMIT` returns. A failed commit turns that batch's replies into 500s. A statement error
  that aborts the transaction fails only its own job: the batch is replayed without it.
- Tokens without `exp`, `alg` other than HS256, bad base64url, or extra segments are rejected.
- No kernel tuning, no CPU pinning. In-process only: the soft RLIMIT_NOFILE is raised to the hard
  limit, and options are set on the listening socket (inherited by accepted sockets).
- Never crashes on EMFILE/ENFILE/ENOMEM/ENOBUFS: accept errors pause and retry on the 1 s tick,
  and ENOBUFS re-arms the receive. Error paths don't open files.
- Idle keep-alives stay open indefinitely (≥ 65 s); stalled partial requests or sends are closed
  after 120 s. SIGTERM: stop accepting, drain in-flight work (≤ 5 s), `wal_checkpoint(TRUNCATE)`.

## Tests

```sh
bash ../../test/run.sh submissions/rust-iouring-sxnistxr   # official 42 checks
cargo test --release                                        # 23 unit tests (+2 needing a seed: TWELVE_SEED=... -- --ignored)
python3 tests/protocol.py --seed SEED [--long]              # 14 checks: pipelining, partial input, limits, 2,000 sockets, 66 s idle
python3 tests/crash.py --seed SEED                          # kill -9 during writes, then verify every acked write
python3 tests/shards.py --seed SEED                         # spill-over across rings, admission ceiling
python3 tests/connmem.py --seed SEED --conns N              # kernel + app memory per idle connection
```

Results so far: 42/42; all unit tests, including a 300k-case differential test of the JSON
reader against serde_json; `kill -9` ×10 under write load, with **0 of 110,768 acknowledged
posts and 0 of 55,062 acknowledged likes lost**; official `load.js` at 12,000 users locally:
p95 2.0 ms, p99 5.9 ms, 0 errors, 34 MB RSS.

**Validated on an Ubuntu 24.04 VPS (1 vCPU Cascade Lake without SHA-NI, 2 GB, kernel 6.8,
like the scoring box):** 42/42, all unit/protocol/shard tests, `kill -9` ×5 with 0 acknowledged
writes lost, and **4.5–4.6 KB of kernel + app memory per idle connection**. That puts the memory
ceiling near 320–330k connections on a 2 GB box; 500k would need ~2.3 GB for sockets alone.

The VPS found two kernel-6.8 behaviours the 6.18 dev box hides, both fixed: completions on extra
rings didn't wake a thread blocked on ring 0 (now a bounded 1 ms wait when several rings are
live), and closing a direct descriptor is deferred while older requests are in flight (now a
hard-linked `shutdown` precedes every close).

**Not yet measured:** capacity under load.js with an external load generator.
