# Would compiling the site to C make it faster?

No, not measurably, for this site. The pages are already compiled at build time into finished
bytes (HTML, brotli and gzip copies, ETags), and serving them is a map lookup. What's left per
request is the network stack and HTTP handling, and in Bun those are already native code.
Measured below on the same machine and core.

## The measurement

`bash bench/native.sh`: the portfolio's built pages, each server **pinned to one core**, wrk on
the other three (64 connections, 10 s, `Accept-Encoding: br, gzip`). Same security headers on
every response. 2026-10-26, 4-vCPU Linux VM.

| server | `/` req/s | `/blog/<slug>` req/s | `/api/blog` req/s | memory |
|---|---:|---:|---:|---:|
| optz on Bun (`optz start`) | 51,760 | 48,514 | 55,921 | 43 MB |
| optz single executable (`optz build --compile`) | 55,469 | 49,761 | 53,930 | 46 MB |
| **nginx (C)** serving `dist/static` directly | 55,469 | 54,553 | 53,786 | 4 MB |

The ceiling on this core is the empty response (`return 200 "ok"`, no file, no headers): nginx
97,469 req/s, `Bun.serve` 101,575 req/s. Half the time per request goes to the kernel's TCP
stack, which no server language changes.

What the numbers say:

- **Speed: a tie.** nginx (C, the fastest common static server) is within ±10% of optz on every
  page, and the difference changes sign between runs. Run-to-run noise is about 5–10%.
- **Bytes: optz sends less.** It serves brotli (1,495 bytes for `/`), nginx here only gzip (1,859).
  For a visitor on a phone, fewer bytes matter more than server microseconds.
- **Memory: C wins.** 4 MB for the nginx worker against ~45 MB for Bun. On the 2 GB VPS that's
  irrelevant today (the Rust engine's connections are what need memory), but it's the one real
  advantage.
- **The compiled executable is the same speed as `optz start`.** `--compile` embeds the Bun
  runtime with your code; it changes how you deploy (one file, nothing to install), not how fast
  it runs.

## Where native code does pay off

- **The social feed** is already native: the Rust engine on raw io_uring and SQLite
  (`portfolio/engine`), because that's per-request work with real computation and a database.
  See [MEASUREMENTS.md](MEASUREMENTS.md).
- **Dynamic page rendering** (React rendering per request) is the one part of the site where
  JavaScript is the cost. optz keeps it off the hot path instead: pages are static or
  client-rendered, dynamic ones are streamed and cached, and `features.dynamic: false` keeps the
  renderer from even loading.
- **TLS and HTTP/2/3**: put nginx (or a CDN) in front. `optz nginx` generates that config, and it
  serves `/assets/` from disk with nginx, which is where its 4 MB footprint helps.

## What compiling to C would cost

Rewriting the site in C (or generating C from React components) would give up hot reload,
islands, typed routes and APIs, Server Actions and the rest of the framework, add memory-safety
risk to code that parses untrusted input, and make every change slower to write. All for a
throughput the C server above doesn't actually beat. The engine shows where it's worth it.
