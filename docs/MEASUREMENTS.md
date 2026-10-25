# Measurements

Where each number came from. Everything here was measured; estimates are labelled as such.

## Memory per idle connection

`submissions/rust-iouring-sxnistxr/tests/connmem.py`, 9,500 connections, each making one
request and then sitting idle (like a k6 user thinking). The script compares this server with a
plain Python accept-and-hold server, so the client sockets cancel out.

| where | kernel | plain socket | io_uring extra | our RSS | server total per connection |
|---|---|---:|---:|---:|---:|
| dev container (4 vCPU Xeon 2.1 GHz) | 6.18 | 3,063 B (MemAvailable) / ~4,040 B (Slab) | 557 B (MemAvailable) / 894 B (Slab) | 510 B | **3.6–4.9 KB** |
| Ubuntu 24.04 VPS (1 vCPU / 2 GB) | 6.8 | *pending* | *pending* | *pending* | *pending* |

`docs/tools/sockmem.py` (raw loopback socket pairs, no server) agrees: 4.1 KB of slab per socket
on 6.18.

**What this means for capacity (estimate, not measured):** the scoring box has 1,967 MB. With
~350 MB for the OS, page cache and app, ~1.6 GB is left for connections, which is ~320k at
5 KB or ~440k at 3.6 KB. 500k connections would need 1.8–2.5 GB for sockets alone. The server's
admission control uses 5,000 B per connection (`src/limits.rs`) until the 6.8 numbers are in.

## Throughput and CPU

See `submissions/rust-iouring-sxnistxr/BENCHMARKS.md`. All local numbers are loopback on a
4 vCPU box with the server pinned to one CPU. They are good for before/after comparisons, not
for capacity.
