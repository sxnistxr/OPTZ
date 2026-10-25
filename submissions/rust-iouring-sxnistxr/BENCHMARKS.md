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
