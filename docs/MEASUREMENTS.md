# Measurements

Where each number came from. Everything here was measured; estimates are labelled as such.

## Memory per idle connection

`submissions/rust-iouring-sxnistxr/tests/connmem.py`, 9,500 connections, each making one
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

See `submissions/rust-iouring-sxnistxr/BENCHMARKS.md`. All local numbers are loopback on a
4 vCPU box with the server pinned to one CPU. They are good for before/after comparisons, not
for capacity.
