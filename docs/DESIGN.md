# Design: rust-iouring-sxnistxr

Status: **implemented.** The decisions below were made without further sign-off, as instructed.
See "What changed during implementation" at the end.
Sections 1–3 of the prompt are approved and not repeated here, except where reading the repo changed a detail.

## 0. What reading the repo changed

Facts from `twelve-dollar-server-challenge@1349c1c` that shape the design:

| Fact | Source | Consequence |
|---|---|---|
| Request mix per user iteration: feed 1, post 1, like 0.15, create 0.02. That is **46.1 % feed, 46.1 % single post, 6.9 % like, 0.9 % create**. | `bench/load.js` | Feed and single post are 92 % of requests. Auth is only 7.8 %, so HMAC speed barely matters (≈1 µs per verify without SHA-NI × 7.8 % ≈ 0.08 µs per average request). I'll use RustCrypto `sha2`+`hmac` unless a benchmark shows a big gap, and spend effort on the read path instead. |
| 500k users ≈ 24.4k iterations/s ≈ **53k req/s, ~4.1k writes/s, ~490 new posts/s**. | arithmetic on `load.js` | At that rate the 20-post feed turns over every ~40 ms, so the newest 20 ids are nearly always contiguous and the range path is the common case. Each recent post gets few likes. |
| Like requests send `Content-Type: application/json` with an **empty body**. | `load.js` | The parser must accept `Content-Length: 0` POSTs, and the like route must not try to parse JSON. |
| The seed feed body is **5,102 bytes**, and the newest 20 seed ids are contiguous (500000…499981). Bodies written under load are ~70 characters. | `test/golden/feed.json` | Most feed responses are 3–5 KB, so send buffers come from 8 KB slabs, with a rare oversized fallback. |
| The leader measured `GROUP BY` like counts **−16 % on feed** and kept a plain range scan counted in Rust. | leader `RESEARCH.md` | I'll benchmark three variants (§4a) rather than assume. |
| The leader inserts then runs `SELECT created_at`, rather than using `RETURNING`, which builds a temp result table. | leader `db.rs` | I'll measure both (§4a). |
| Flagged in other entries: tokens without `exp` accepted, reads that see uncommitted writes, restart loops in `start.sh`, **unchecksummed rustup**, and a crash on EMFILE because the error path opened stderr. | `LEADERBOARD.md` | Each is a named test or rule here. The toolchain comes from a pinned standalone Rust tarball checked against a SHA-256 written into `install.sh`, with no rustup at all. |
| The leader was OOM-killed at 360k/480k. Its cgroup peak was 450 MB at 100k users locally and 630 MB at 264k on the scoring box. | leaderboard, leader `IO_URING.md` | Memory, not CPU, is the first wall past ~300k (§4b). |

**Measured here (not on the scoring box):** kernel 6.18, loopback, 18,000 idle established sockets after one
request/response each: **slab grew 4.1 KB per socket** (`/proc/meminfo` Slab delta; script: `docs/tools/sockmem.py`).
At that cost, 500k sockets need ~2.0 GB of kernel memory alone, which is more than the 1,967 MB box.
Ubuntu 24.04 (kernel 6.8) may differ, so this must be re-measured on a 6.8 box before setting the admission
ceiling. **Until then I treat 500k as probably memory-infeasible with one keep-alive socket per user, and the
realistic ceiling is somewhere between ~330k (at 4.1 KB/socket) and ~500k (at ≤2.5 KB/socket).**

---

## 4a. SQL and the feed path

All statements are prepared once at startup with `SQLITE_PREPARE_PERSISTENT`. Reads run on the read
connection; writes run on the writer connection.

### Feed (46 % of requests)

```sql
-- F1: newest 20 ids, walking posts_created_at_id_idx (covering: rowid is in the index)
SELECT id FROM posts ORDER BY created_at DESC, id DESC LIMIT 20;
-- F2 (range path): rows for the id span, rowid range scan on posts + user lookup
SELECT p.id, p.body, p.created_at, u.username
  FROM posts p JOIN users u ON u.id = p.user_id
 WHERE p.id BETWEEN ?1 AND ?2;
-- F3 (range path): like counts, covering scan of likes_post_id_idx
SELECT post_id FROM likes WHERE post_id BETWEEN ?1 AND ?2;
-- F_exact (sparse fallback): the reference query
SELECT p.id, p.body, p.created_at, u.username,
       (SELECT count(*) FROM likes l WHERE l.post_id = p.id)
  FROM posts p JOIN users u ON u.id = p.user_id
 ORDER BY p.created_at DESC, p.id DESC LIMIT 20;
```

- **Range path** when `max(id) − min(id) < 64`. Under load the span is 19, so this is the common case.
  F2 returns at most 64 rows, and rows whose id isn't in the F1 set are skipped. F3 counts into a 64-entry array
  indexed by `post_id − lo`. Output follows F1's order, so ties and any created_at/id disagreement come out
  exactly as the reference query would.
- **Exact fallback** for sparse spans: still correct, only slower.
- **Consistency:** F1–F3 run inside one read transaction, so they see one snapshot and the post set, rows and
  counts all agree.
- **Variants to benchmark for F3** (seeded DB + a synthetic churn DB): (a) F3 counted in Rust, (b) F3 with
  `GROUP BY post_id`, (c) 20 point `count(*)`s on a prepared `SELECT count(*) FROM likes WHERE post_id=?`.
  The cheapest by measurement wins, and all results go in BENCHMARKS.md.
- **Output without intermediate allocation:** `sqlite3_column_text` pointers die on the next `step`, and output
  order (F1) can differ from scan order (F2). So F2 rows are copied once into a per-thread scratch arena that is
  reused and never freed. The JSON is then written into the connection's send slab in F1 order, escaping in the
  same pass. If F2 rows arrive in exactly the reverse of F1 order (the normal case), I'll test writing straight
  from column pointers with no scratch copy at all, scanning `ORDER BY p.id DESC` and checking each id against
  F1. The scratch copy stays as the fallback.
- Integer formatting is hand-written, or the `itoa` crate if it measures faster. `created_at` and `username` are
  checked once to be JSON-safe, which they always are, using the same escaper's fast path.

### Single post (46 %)

```sql
SELECT p.id, p.body, p.created_at, u.username,
       (SELECT count(*) FROM likes l WHERE l.post_id = p.id)
  FROM posts p JOIN users u ON u.id = p.user_id WHERE p.id = ?1;
```
This is one statement and one step, written directly from column pointers. The id parse is strict: ASCII digits
only, no sign, no leading `+`, value 1..=2^63−1, and anything else gets `invalid post id`. Ids above 2^53 are out
of scope, but they still parse correctly.

### Like (6.9 %): writer thread

```sql
-- L1: one statement on the hot path; inserts only if the post exists
INSERT INTO likes(user_id, post_id) SELECT ?1, ?2 WHERE EXISTS (SELECT 1 FROM posts WHERE id = ?2)
ON CONFLICT(user_id, post_id) DO NOTHING;
-- L2: only when sqlite3_changes() == 0, to tell "already liked" (200) from "no such post" (404)
SELECT 1 FROM posts WHERE id = ?1;
```
`changes == 1` gives 201 with `already_liked:false`. Otherwise L2 decides between 200 `already_liked:true` and 404.
This is equivalent to the prompt's "check existence, then `ON CONFLICT DO NOTHING`", with one statement fewer on
the common path. `user_id` comes from the token's `sub`, unchecked against `users`, as the spec says it isn't looked
up. Whether to enable `foreign_keys` is an open choice. It's off by default, and then a `sub` with no user row
still inserts a like. The leader turns it on, which makes that case a 500. All seeded tokens name existing users,
and I'll test both settings.

### Create (0.9 %): writer thread

Candidates, measured:
(a) `INSERT INTO posts(user_id, body) VALUES (?1, ?2) RETURNING id, created_at`
(b) the same INSERT, then `sqlite3_last_insert_rowid` and `SELECT created_at FROM posts WHERE id = ?`.
`created_at` always comes from the column default, never from application time. Body validation (JSON parse, trim,
1..=500 characters counted as Unicode scalar values, matching SQLite `length()` on TEXT) happens on the network
thread before the job is queued, so the writer only does SQL.

### Health

`SELECT 1` on the read connection, run on every request. If it fails, return 503 with `sqlite3_errmsg` as the
`error` string, JSON-escaped.

### SQLite build and pragmas

- Built from the official amalgamation, version pinned and SHA-256 verified, with
  `SQLITE_THREADSAFE=2 SQLITE_DEFAULT_MEMSTATUS=0 SQLITE_OMIT_DEPRECATED SQLITE_OMIT_SHARED_CACHE
  SQLITE_LIKE_DOESNT_MATCH_BLOBS SQLITE_DQS=0 SQLITE_DEFAULT_WAL_SYNCHRONOUS=2 SQLITE_OMIT_LOAD_EXTENSION
  SQLITE_OMIT_PROGRESS_CALLBACK HAVE_FDATASYNC=1 SQLITE_USE_ALLOCA`.
- Both connections: `journal_mode=WAL` (already set in the seed; asserted), `synchronous=FULL`, `mmap_size=1 GiB`
  (covers the ~250 MB seed plus growth; mmap pages are reclaimable page cache), `temp_store=MEMORY`,
  `cache_size=−8192` (8 MB, tuned by measurement).
- Reader: `query_only=1`. Writer: `wal_autocheckpoint=0` (checkpoints are explicit, §4c), `journal_size_limit=64 MB`.
- **PGO of SQLite:** a later, separately measured step, trained on a synthetic database generated at build time
  (no seed data). It only ships if BENCHMARKS.md shows a win.

---

## 4b. Connections and memory

### Rings and connection table

- **8 shard rings + 1 master ring, all driven by the network thread.** Each shard registers a sparse fixed-file
  table of 65,535 slots (`IORING_REGISTER_FILES_SPARSE`; the table is capped at RLIMIT_NOFILE), giving 524,280
  slots in all. The master ring holds a multishot `POLL_ADD` on each shard ring's fd, plus the writer's eventfd,
  a signalfd and a 1 s timer. When the master reports a shard ready, the thread reaps that shard's CQEs in a batch.
- Accept: **one listening socket**, with multishot *direct* accept armed on exactly one shard at a time. When that
  shard's table fills, accept moves to the next shard with free slots. I'll prototype this against
  8 × `SO_REUSEPORT` listeners and keep whichever costs less CPU per accepted connection. The single-armed design
  is the default because it never refuses a connection while another shard has room.
- **The connection slot (≤ 64 bytes, idle connections hold nothing else):**
  generation u32, state u8, flags u8, deadline u16 (coarse seconds, wrapping), input handle u32 (0 = none),
  output handle u32, output offset/length u32, intrusive deadline-list links 2 × u32, user id u64 copy for in-flight
  writes. That is about 40 bytes, padded to 64 for cache alignment. 524,280 slots × 64 B = 33.5 MB, allocated
  lazily in 4,096-slot chunks so a lightly loaded server stays small.
- `user_data` on every SQE = shard (3 bits) | slot (17 bits) | generation (32 bits) | op (4 bits). A completion
  whose generation doesn't match the slot's is a stale CQE for a reused slot. Its buffers are returned and the
  CQE is otherwise ignored.

### Buffers

- **Receive:** one provided-buffer ring per shard, 1,024 × 2 KB (16 MB total). A k6 request is 150–450 bytes, so
  one buffer is almost always a whole request. It's parsed in place and handed back to the ring in the same
  batch. A request split across completions is copied into a pooled 4 KB "partial input" block, the only receive
  state an idle connection can ever hold, and freed when the request completes. Requests over 16 KB are out of
  scope: answer 413 or close.
- **Send:** a slab pool of 8 KB blocks, bounded (default 8,192 blocks = 64 MB, sized from the memory budget
  below). A rare oversized response (20 maximal 500-character bodies with escapes) takes a heap allocation from a
  bounded counter. A slab returns to the pool on its final send completion. Idle connections hold no send buffer.
- **ENOBUFS** on multishot recv (the provided ring ran dry): put the connection on a bounded re-arm queue that's
  drained after buffers are returned in the same loop iteration. Never spin, and never allocate.

### Per-socket kernel buffers

- `SO_RCVBUF`: set small (start at 4 KB, then measure the smallest that doesn't add round trips). That turns off
  receive autotuning and bounds the worst-case receive memory per socket.
- `SO_SNDBUF`: set to hold one maximal normal response (start at 16 KB; the kernel doubles it) so that a feed
  goes out in one `send`.
- Neither reduces the **fixed** cost of an idle socket (`tcp_sock`, inode, file, dentry), which dominates at
  scale. They only cap bursts, so I'll measure them, not assume a gain.

### Memory-budget admission control

Two layers, both computed without allocating or opening files on the hot path:
1. **Static ceiling** at startup: `max_conns = (MemTotal − reserve) / per_conn_cost`. `reserve` covers the
   OS (~200 MB), the app (rings, slabs, connection table) and a minimum page cache for SQLite's hot set. 
   `per_conn_cost` is the **measured** kernel+app cost per idle connection on Ubuntu 24.04 (6.8), compiled in as a
   constant with a comment pointing to the measurement. It's a constant, not configuration, so the env-only rule
   holds.
2. **Dynamic floor**, every second on the 1 s timer: `pread` `/proc/meminfo` through an fd opened at startup. If
   `MemAvailable` drops below a floor (default 96 MB), stop arming accept and fast-close new connections
   (`SO_LINGER{1,0}` then close) until it recovers past floor + 32 MB. Existing connections are never killed. A
   refused connection is one k6 error; an OOM kill fails the whole run.

### Backpressure and timeouts

- While a connection has unsent output, its recv is paused (the multishot recv is cancelled or not re-armed), so
  pipelined input can't pile up responses.
- Deadlines exist only for connections that hold a partial request or a pending send (120 s). Those sit on an
  intrusive deadline list swept by the 1 s timer. Idle keep-alive connections are on no list and are never
  closed by the server (well above the 65 s minimum).
- Errors: EMFILE/ENFILE/ENOMEM/ENOBUFS from accept, recv and send are counted in fixed atomic counters and handled
  in place: re-arm later, close the connection, or pause accept. There is no logging on hot error paths. Stderr
  is written only with a preformatted, rate-limited `write(2)` on fd 2, which is already open, so the error path
  never opens a file (the C# failure mode).

---

## 4c. Durability and operations

### Write path

- The network thread validates the request and pushes `Job { slot ref, kind, user_id, post_id | body span }`
  into a fixed-capacity SPSC ring (lock-free, 4,096 entries). Bodies are copied into a job-owned 512 B block.
  If the queue is full, the connection's input is paused until there is room. The queue never drops a job.
- **Writer loop:**
  1. Block on a futex/eventfd until there are jobs.
  2. Drain everything pending (cap 1,024 per batch).
  3. `BEGIN IMMEDIATE`, then run each job's statement(s).
  4. `COMMIT`. In WAL with `synchronous=FULL`, this fsyncs the WAL before it returns.
  5. Push results to the reply SPSC ring and `write` the eventfd that the master ring watches.
  6. The network thread then formats and sends the 201/200/404 replies. **No reply exists before step 4 returns
     success.**
- **SAVEPOINT per job: proposed change.** Each job is a single write statement (L1, or the create INSERT), and
  SQLite already rolls back a single failed statement without aborting the transaction. So a savepoint adds two
  statements per job for no extra isolation. My proposal: no savepoints. If a statement failure *does* abort the
  transaction (`sqlite3_get_autocommit` turns true: IOERR, FULL, NOMEM), the batch's earlier jobs are re-run in
  a fresh transaction once, and if that fails too, all of them get 500. Savepoints come back if a job ever needs
  more than one write. **This deviates from §3 and needs your OK.**
- A failed `COMMIT` → `ROLLBACK`, and every tentative reply in that batch becomes 500 `internal server error`.
- **Read-your-writes:** a client only sends its next request after receiving the reply, and the reply is only sent
  after commit. The network thread opens a fresh read transaction per completion batch and always ends it at the
  end of the batch. So any read the client sends after a 201 starts a snapshot that includes the commit. A read
  never sees an uncommitted write, because it runs on the other connection.

### Checkpoints

- With `wal_autocheckpoint=0`, after each commit the writer checks the WAL frame count. Past 4,096 frames (~16 MB),
  it runs `wal_checkpoint(PASSIVE)` on the writer thread. Reads continue on the network thread, and writes simply
  wait for the next batch.
- Read transactions last one completion batch, so they never pin the WAL for long, and the WAL restarts from the
  beginning on the next write after a complete checkpoint. If the WAL still passes 64 MB, a `RESTART` checkpoint
  with a 50 ms busy timeout forces it.
- The checkpoint threshold is tuned by measurement. A checkpoint stalls writes but not reads, which is the point of
  the two-thread split.

### Signals, startup, start.sh

- SIGTERM/SIGINT go through a signalfd on the master ring. Shutdown: stop arming accept, finish the in-flight
  write batch and send its replies, stop taking new jobs (new writes get 503), close sockets, then the writer runs
  `wal_checkpoint(TRUNCATE)` and both connections close. The whole thing is bounded at 5 s, after which the process
  exits with unsent replies dropped. Acknowledged writes are already durable either way.
- Startup: open the database, set pragmas, prepare statements, no table scans. WAL recovery happens on first
  access. The target is healthy in under 1 s on the seed.
- `start.sh` is a single `exec` of the binary with nothing looping, so systemd sees every crash.
- `/health` really runs `SELECT 1` on every request.

### Production extras in `ops/` (outside the submission)

- `optz.service`: `User=optz`, `Restart=on-failure`, `LimitNOFILE=65535`, `AmbientCapabilities=CAP_NET_BIND_SERVICE`,
  `MemoryMax=1800M` / `MemoryHigh=1700M`, `ProtectSystem=strict`, `ReadWritePaths=<db dir>`, `NoNewPrivileges=yes`,
  `PrivateTmp=yes`, `ProtectHome=yes`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX`, `SystemCallFilter=@system-service io_uring_setup io_uring_enter io_uring_register`
  (to be verified on the box).
- `optz-backup.service` + `.timer` (hourly): the `sqlite3` CLI, built from the same amalgamation, runs
  `VACUUM INTO` (or `.backup`; whichever holds the WAL lock for less time) into a dated file. Then
  `PRAGMA integrity_check` on the copy, zstd compression, and keeping 24 hourly and 14 daily copies.
  The unit fails loudly if the check fails.
- Off-box replication: I'll check whether Litestream is still maintained (late 2026) before recommending it.
  Otherwise `rclone` the verified backups to object storage.
- `RESTORE.md`: stop the service, verify the backup's checksum and integrity, replace the database (and remove
  stale `-wal`/`-shm`), start, check `/health` and the newest post id.
- journald: `SystemMaxUse=200M` drop-in. The server logs only startup, shutdown and rate-limited errors, never
  per-request lines.
- The sync timer already on your VPS (`deploy/`) becomes the deploy path: `post-deploy.sh` builds as the service
  user and restarts the unit, but only if the build succeeds.

---

## 4d. Testing and verification

| Layer | What | Pass criterion |
|---|---|---|
| Official | `test/run.sh submissions/rust-iouring-sxnistxr` on a fresh seed | 42/42, output pasted into BENCHMARKS.md |
| Unit: HTTP | byte-at-a-time partial input, pipelining (3 requests in one buffer), oversized header/body, garbage, `Content-Length` vs missing, lowercase headers, `Connection: close` | exact parse/close decisions |
| Unit: JWT | valid; bad signature; expired; **missing exp**; `alg:none`; `alg:HS512`; header not JSON; 2 or 4 segments; bad base64url (padding, `+/`); `sub` "abc"/"0"/"-1"/number; `username` missing/number | each lands in the right one of the three 401 messages |
| Unit: JSON | escapes (`\" \\ \/ \b \f \n \r \t \uXXXX`, surrogate pairs, lone surrogates rejected), raw control characters rejected, trailing garbage, duplicate keys (last wins, as `JSON.parse` does), trim with Unicode whitespace vs ASCII (matching JS `String.trim`, as the reference uses), the 500-character boundary counted in scalar values | **differential against `serde_json`** (dev-dependency) on generated inputs |
| Unit: ids, writer | id parsing table; writer batch with one failing job; forced COMMIT failure → all 500 | exact |
| Crash / power loss | write load with 200 connections → `kill -9` the server mid-batch (at random times, ×20) → restart → every id that got a 201 exists with its body, and every acknowledged like row exists | 0 missing over all rounds. A separate VM-level test (hard reset of a VM, if available) is the only real power-loss check, and I'll label it as such |
| Load: official | `k6 run bench/load.js` (k6 pinned and checksum-verified) | p95/p99/error thresholds, with RSS and cgroup memory recorded |
| Load: connections | a small Rust client opening 100k/250k/500k idle keep-alive connections from many 127.x.y.z source addresses, one request each, then idle | server-side memory per connection (cgroup `memory.current` + slab delta), measured |
| Accounting | µs/request = server CPU time (`/proc/pid/stat` utime+stime, or cgroup `cpu.stat`) ÷ requests; RSS; cgroup memory | recorded for every change in BENCHMARKS.md, including rejected ones |

**What this container can and can't measure** (checked): 4 vCPUs (Xeon 2.1 GHz **with** SHA-NI, unlike the
scoring box), 16 GB, kernel 6.18, io_uring works, **fd hard limit 20,000**, no cgroup controllers. So here I can do
correctness, unit, differential and crash tests, plus single-core CPU comparisons via `taskset` on the load-generator
side only. **I can't do** 65,535+ connections, Ubuntu 6.8 kernel memory, cgroup memory accounting, or anything like
the scoring numbers. Those need a 1 vCPU / 2 GB Ubuntu 24.04 box and a separate load-generator machine, and every
number in BENCHMARKS.md will be labelled with where it was measured.

---

## Implementation plan

Small commits, each one passing its tests.

1. **Skeleton** (`submissions/rust-iouring-sxnistxr/`): `install.sh` (pinned standalone Rust tarball, SHA-256 in the
   script, and apt packages), `build.sh` (SQLite amalgamation with SHA-256, `cargo build --release --locked`),
   `start.sh`, `.gitignore`, `Cargo.toml`/`Cargo.lock` with exact pins (versions looked up then, not recalled).
2. **Correct and simple:** one ring, no fixed files, the reference queries, a writer thread with group commit.
   **Goal: 42/42 on `test/run.sh`.**
3. **Tests:** HTTP, JWT, JSON (with serde_json differential), ids, writer failure, crash test.
4. **Network scale-out:** fixed-file shards, master ring, provided buffers, slabs, backpressure, timeouts,
   admission control, plus the many-connection test client and memory measurements.
5. **Read-path optimizations, one at a time, each measured:** feed range path and F3 variants, direct output, read
   transaction per batch, pragmas and cache size, create (a) vs (b), SQLite PGO. Each goes into BENCHMARKS.md with
   before/after numbers.
6. **`ops/` and docs:** systemd units, backup, restore runbook, journald, deploy hook, final README.
7. **Validation on a 1 vCPU / 2 GB box** (your VPS, if its specs fit) with an external load generator.

## Decisions I need from you

1. **Drop SAVEPOINT-per-job** in favour of statement atomicity plus a one-time batch retry (§4c)?
2. **Use your VPS as the test box?** What are its vCPU/RAM/disk specs? Real load numbers also need a *second*
   machine to run k6. A VPS can't load-test itself honestly.
3. **500k expectations:** on the kernel measured so far, 500k sockets don't fit in 2 GB. I'll design for it and set
   the admission ceiling from the 6.8 measurement, but the honest target may be ~330–450k, and I'll report what's
   actually measured.


---

## What changed during implementation

| Planned | Done | Why |
|---|---|---|
| SAVEPOINT per write job | No savepoints. A job that aborts the transaction is dropped and the batch replayed | Each job is one statement, which SQLite already makes atomic. The replay path is unit-tested with a test-only trigger |
| Multishot direct accept | 16 single-shot accepts in flight, each counted against a shard's free slots | With multishot, a full fixed-file table made the kernel accept and then drop a connection (4 of 5,000 lost) |
| Feed F3 variants to benchmark | Range scan counted in Rust (5.7 µs) beat `GROUP BY` (8.0) and point counts (10.2) | `feed_variants` test, BENCHMARKS.md §4 |
| Create: RETURNING vs separate SELECT | RETURNING kept | Creates are 0.9 % of traffic; not worth a second statement |
| HMAC library comparison | RustCrypto `sha2`/`hmac` without comparison | Auth is 7.8 % of requests (~0.08 µs of the average request) |
| SO_RCVBUF/SO_SNDBUF tuning | Kernel defaults | No measurable CPU difference; idle sockets hold no buffers either way |
| Completion batching | Not shipped | No gain under saturation, and it can't be exercised in its target regime locally |
| SQLite PGO | Done, trained on a synthetic DB generated at build time | feed −7 %, mixed −5 to −12 % (BENCHMARKS.md §8) |
| (unplanned) `SQLITE_ENABLE_QPSG` | Added | The single-post statement was re-prepared on every request; 2.3× faster single-post reads |
| (unplanned) single-step backups | Backup API in one step | A batched backup restarts on every write and never finished under steady writes |
