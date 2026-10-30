# Measurements

Historical measurements from several distinct workloads. Estimates are labelled; these figures
are not a fresh audit of the redesigned website or the full-stack starter.

## Reading the evidence

- [Network benchmark](OPTZ-VS-NEXTJS.md): October 27, 2026 historical site build, raw data in `bench/results.json`.
- [Routing/dispatch benchmark](FULLSTACK-RESEARCH.md#measured-dispatch-result): October 28, 2026 warmed in-process operations, raw data in `bench/fullstack-results.json`. This does not measure auth, SQLite, SSR or network latency.
- The connection-memory and frontend-mode tables below are earlier experiments. Their environment and workload differ from both benchmarks above; no new measurement date or source commit is asserted for them.

## Memory per idle connection

`portfolio/engine/tests/connmem.py`, 9,500 connections, each making one
request and then sitting idle (like a k6 user thinking). The script compares this server with a
plain Python accept-and-hold server, so the client sockets cancel out.

| where | kernel | plain socket | io_uring extra | our RSS | server total per connection |
|---|---|---:|---:|---:|---:|
| dev container (4 vCPU Xeon 2.1 GHz) | 6.18 | 3,063 B (MemAvailable) / ~4,040 B (Slab) | 557 B (MemAvailable) / 894 B (Slab) | 510 B | **3.6–4.9 KB** |
| Ubuntu 24.04 VPS (1 vCPU / 2 GB), 40k conns | 6.8 | 4,031 B (Slab) / 3,434 B (MemAvailable) | 340 B (Slab) | 164 B | **~4.5 KB** |
| Ubuntu 24.04 VPS, 80k conns (2 rings) | 6.8 | 4,001 B (Slab) / 3,544 B (MemAvailable) | 467 B (Slab) | 147 B | **~4.6 KB** |

`docs/tools/sockmem.py` (raw loopback socket pairs, no server) agrees: 4.1 KB of slab per socket
on 6.18.

On 6.8 the MemAvailable-based numbers are noisy (page cache moves under them; one run
gave a negative difference), so the slab figures are the ones used.

**What this means for capacity (estimate from measured parts):** the scoring box has 1,967 MB
and no swap. Our VPS (same OS) uses ~330 MB idle. Leaving ~150 MB for SQLite's hot pages,
buffers and slack, ~1.49 GB remains for connections: **~320–330k connections at 4.5–4.6 KB**.
500k connections would need ~2.3 GB for sockets alone, more than the box has. So with one
keep-alive socket per user (which load.js uses), **500k is not reachable on this box from memory
alone**, whatever the CPU cost per request. The admission ceiling uses 4,800 B per connection
(`src/limits.rs`): (1,967 − 320) MB / 4,800 B ≈ 360k, with the MemAvailable floor as backstop.

## Throughput and CPU

See [Engine benchmark log](../portfolio/engine/BENCHMARKS.md). All local numbers are loopback on a
4 vCPU box with the server pinned to one CPU. They are good for before/after comparisons, not
for capacity.

## Frontend: JavaScript per page (portfolio)

Chromium, cold load, scripts only (compressed as sent / decoded size to parse). Measured with
the same seed data and API for every column.

| page | SPA + React | islands + React | islands + Preact (historical) |
|---|---:|---:|---:|
| `/` (2 islands) | 66.6 / 207.8 KB | 64.0 / 209.9 KB | 14.5 / 18.2 KB |
| `/blog` (no islands) | 63.6 / 214.2 KB | 3.3 / 5.5 KB | 2.9 / 5.6 KB |
| `/blog/<post>` (no islands) | 63.1 / 208.1 KB | 3.3 / 5.5 KB | 2.9 / 5.6 KB |
| `/social` (1 island) | 66.5 / 215.4 KB | 64.2 / 213.2 KB | 14.7 / 21.3 KB |

## The Bun server (optz), one core, wrk 128 connections, local

| what | req/s |
|---|---:|
| static page from memory (brotli) | 57–64k |
| `/api/blog` with the response cache | 47–53k |
| `/api/blog` without it (re-reads the Markdown) | 2.2k |
| `/api/social/feed` from the nginx micro-cache (1 s) | 61k |

Memory: 29.7 MiB idle and ~45 MiB peak under load with `features.dynamic: false`. A single
dynamic render loads React's server renderer: 43.1 MiB idle afterwards (+13.4 MiB).
