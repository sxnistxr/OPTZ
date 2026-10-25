# Benchmark log

Every optimization attempted, with before/after numbers, including the rejected ones.

## Method (local)

`bench/run.py`: fresh seed copy per trial; server pinned to one CPU with `taskset` (test harness
only, the submission never pins); wrk (3 threads, 64 keep-alive connections) on the other three
CPUs running `bench/mix.lua`; 5 s warm-up then a 10–15 s measured window. **µs/req** is the
server's own CPU time (utime+stime from `/proc/<pid>/stat`) divided by requests completed.

Machine: 4 vCPU Intel Xeon @ 2.1 GHz (AVX-512, **with** SHA-NI), kernel 6.18, loopback.
Caveats: on loopback the server's CPU time also includes part of the client's receive path
(softirq runs on the sending CPU), and SHA-NI makes HMAC cheaper than on the scoring box.
**These numbers are for before/after comparisons only. They are not capacity claims.**

Workloads: `feed`, `post` (random id in the newest 5,000), `like`, `create`, and `mixed`,
which matches `bench/load.js` (46.1 % feed, 46.1 % post, 6.9 % like, 0.9 % create).

## Results

### 1. Baseline (first version passing 42/42)

| workload | req/s | µs/req | p99 |
|---|---:|---:|---:|
| feed | 39,034 | 23.43 | 11.3 ms |
| post | 47,813 | 18.43 | 10.2 ms |
| like | 8,517 | 51.21 | 71.5 ms |
| create | 15,346 | 30.71 | 25.0 ms |
| mixed | 32,691 | 27.95 | 53.1 ms |

### 2. `SQLITE_ENABLE_QPSG`: accepted

perf showed `sqlite3RunParser`/`yy_reduce` (SQL parsing) on the single-post path.
`sqlite3_stmt_status(SQLITE_STMTSTATUS_REPREPARE)` confirmed it: **200 re-prepares in 200 calls**
of the single-post statement. The planner's `exprCompareVariable` marks that statement to be
re-planned whenever `?1` changes, so it re-parsed its SQL on every request. The Query Planner
Stability Guarantee fixes each plan at prepare time. These queries are plain index lookups, so a
fixed plan is the right one anyway. After the change: 0 re-prepares (a regression test is in
`src/db/read.rs`).

| workload | before req/s | after req/s (2 trials) | before µs/req | after µs/req |
|---|---:|---:|---:|---:|
| feed | 39,034 | 46,381 / 47,027 | 23.43 | 21.19 / 20.97 |
| post | 47,813 | 112,218 / 104,554 | 18.43 | 8.77 / 9.38 |
| mixed | 32,691 | 44,731 / 45,652 | 27.95 | 20.39 / 20.00 |

### 3. Word-at-a-time JSON escaping: accepted (small)

perf put `json::write_str` at 9.6 % of feed samples (a byte-at-a-time table lookup). Now it
checks 8 bytes per step with a SWAR test (`(x - n·LO) & !x & HI`) and only examines single bytes
in a word that contains something to escape. Correctness: a round-trip test against
serde_json on 8,000 random strings with escapes and multibyte UTF-8, plus an exhaustive check of
the word test for every ASCII byte.

| workload | before µs/req | after µs/req (2 trials) |
|---|---:|---:|
| feed | 21.19 / 20.97 | 20.85 / 19.93 |
| mixed | 20.39 / 20.00 | 20.46 / 20.97 |

Feed improves about 3 %. Mixed is unchanged, within noise.

### 4. Feed strategy (in-process SQL cost, `feed_variants` test): current range path kept

20,000 feeds per variant on the seed, server code pinned to one CPU, two runs:

| strategy | µs/feed |
|---|---:|
| exact reference query (20 correlated `count(*)` subqueries) | 20.41 / 19.70 |
| **range path: F1 ids + F2 rows + F3 likes counted in Rust** | **14.56 / 14.20** |
| part, F1 newest 20 ids | 2.27 / 2.15 |
| part, likes, range scan counted in Rust (F3) | **5.80 / 5.57** |
| part, likes, `GROUP BY post_id` over the range | 7.90 / 8.03 |
| part, likes, 20 point `count(*)` | 10.35 / 10.14 |
| part, rows, rowid range scan + user join (F2) | 5.89 / 5.70 |
| rows via `ORDER BY created_at DESC, id DESC LIMIT 20` + join (would replace F1+F2) | 9.16 / 9.84 |

- The range path is 28–30 % cheaper than the exact query, and the test asserts it produces
  identical bytes.
- Counting likes in Rust from a covering range scan beats `GROUP BY` by ~28 % and point
  counts by ~45 %. This matches the leader's finding.
- **Rejected:** fetching rows through the created_at index walk instead of F1 + range scan
  (9.2–9.8 µs vs 8.0–8.5 µs).
- Note: seed posts have ~5 likes each. Under load the feed is mostly fresh posts with few likes,
  so F3 gets cheaper.

### 5. Fixed `SO_RCVBUF`/`SO_SNDBUF` on the listener (inherited): rejected

perf showed `tcp_rcv_space_adjust` (receive autotuning) at ~1.5 % of the single-post profile.
Fixing the buffers turns autotuning off.

| config | post req/s | post µs/req | feed req/s | feed µs/req |
|---|---:|---:|---:|---:|
| defaults (control 1) | 114,716 | 8.55 | 50,492 | 19.49 |
| SO_RCVBUF=4096 | 110,656 | 8.87 | 49,903 | 19.68 |
| SO_RCVBUF=4096, SO_SNDBUF=32768 | 111,961 | 8.79 | 51,068 | 19.34 |
| defaults (control 2) | 111,597 | 8.81 | 48,888 | 20.19 |

All four are within the ±3 % spread of the two controls. Idle sockets hold no buffer memory
either way (the cost per idle socket is fixed slab), so I'm keeping kernel defaults.

### 6. Adaptive completion batching (wait for 32 CQEs or 250 µs when busy): rejected

The idea: under sustained load, wait for several completions per `io_uring_enter` rather than
waking for each one, as the leader does. Two measurements:

**Open-loop rate (`bench/rate.py`, k6 `constant-arrival-rate`, 2,000 connections, load.js mix):**

| build | 5,000 req/s: µs/req | p95 |
|---|---:|---:|
| no batching | 61.93 | 18.2 ms |
| batching | 62.00 / 60.67 | 15.7 / 9.8 ms |

Batching never engaged at 5k req/s: an iteration rarely sees ≥4 completions, which is the busy
threshold. Above ~13k req/s k6 on three cores is the bottleneck (dropped iterations with the
server at ~50 % CPU), so this box can't produce the high-rate, unsaturated regime the scoring
hold runs in. Note that the high µs/req at low rates here is mostly loopback cost: each send
wakes a k6 thread on another CPU (IPI and wakeup in the server's profile), which a real NIC
doesn't charge to the server.

**Saturated (wrk mixed, closed loop):**

| build | 64 conns: req/s, µs/req | 1,024 conns: req/s, µs/req |
|---|---:|---:|
| no batching | 45,687 / 19.94; 44,177 / 20.48 | 47,521 / 18.80; 44,838 / 19.81 |
| batching | 45,342 / 20.26; 42,978 / 21.44 | 45,556 / 19.67; 44,509 / 20.04 |

No gain, slightly worse. Rejected; it can be re-tested on a 1 vCPU box with an external
load generator, where the regime it targets actually exists.

### 7. Official `bench/load.js` at 12,000 users (local, 30 s ramp + 90 s hold)

p95 2.02 ms, p99 5.91 ms, 0 failed out of 162,306 requests, server RSS peak 34 MB. The server
ran at ~10 % CPU (k6 at 12k users produces only ~1.3k req/s). This shows correctness under the
real user model with keep-alive connections, not capacity.

### 8. SQLite PGO trained on synthetic data: accepted

`build.sh` instruments SQLite (`-fprofile-generate`) and runs `bench/pgo_train.py`. That script
generates a random database with the same schema (20k users, 100k posts, ~400k likes; **no
challenge seed data**), drives the load.js mix over keep-alive connections for 12 s, and stops
the server with SIGTERM to write the profile. SQLite is then rebuilt with `-fprofile-use`. Only
the SQLite C code is profiled; the Rust side is unchanged. If any step fails, the plain build
is kept.

A/B on the seed, three interleaved pairs (µs/req):

| workload | plain | PGO |
|---|---|---|
| feed | 18.93 / 18.74 / 19.65 | **17.77 / 17.52 / 17.62** |
| post | 8.37 / 8.61 / 8.41 | 8.62 / 8.56 / 8.49 |
| mixed | 19.69 / 20.01 / 19.87 | **17.41 / 18.49 / 18.89** |

Feed −7 % (every pair), mixed −5 to −12 % (every pair), single post neutral. Through `build.sh`
end to end: feed 17.44, mixed 18.83. The official suite passes 42/42 on the PGO build. The
build takes ~2 m 50 s on this 4-core box; expect several minutes on 1 vCPU.
