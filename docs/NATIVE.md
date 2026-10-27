# Would compiling the site to C make it faster?

Somewhat, on raw throughput: nginx (C) serving the same built files beat optz by 20-30% on
pages in the run below. Not by an order of magnitude, and not in bytes sent. The pages are already
compiled at build time into finished bytes (HTML, brotli and gzip copies, ETags), and serving them
is a map lookup; what's left per request is mostly the network stack and HTTP handling.

## The measurement

`bash bench/native.sh`: the portfolio's built pages, each server **pinned to one core**, wrk on
the other three (3 threads, 64 connections, 10 s, `Accept-Encoding: br, gzip`), **3 runs per
URL, median shown**. Same security headers on every response. Every run, the sizes and the
provenance (commit `3c64ad9`, clean tree; the VM's CPU, kernel and tool versions) are in
[`bench/native-results.json`](../bench/native-results.json). 2026-10-27, a 4-vCPU cloud VM
(Intel Xeon @ 2.80 GHz), Bun 1.4.4, nginx 1.24.

| server | `/` req/s | `/blog/<slug>` req/s | `/api/blog` req/s | memory after load |
|---|---:|---:|---:|---:|
| optz on Bun (`optz start`) | 25,507 | 23,306 | 27,793 | 46 MB |
| optz single executable (`optz build --compile`) | 25,938 | 24,156 | 29,725 | 50 MB |
| **nginx (C)** serving `dist/static` directly | **31,078** | **30,520** | 29,415 | **12 MB** |

Memory is the RSS of each server's whole process tree after the load (nginx's master and worker
together). The ceiling on this core is an empty `200 ok` response with no file and no headers:
nginx 63,376 req/s, `Bun.serve` 69,105 req/s (medians of 3).

What the numbers say:

- **Speed: nginx is ahead on pages, by 20-30% here.** On the prerendered JSON it's a tie. Runs
  vary by about 5-15% (all of them are in the JSON), so the gap on pages is real, not noise. An
  earlier, single-run measurement on another VM showed a tie; that one wasn't repeated or saved.
- **The empty-response ceiling is even.** Bun's HTTP server is as fast as nginx's when there's
  nothing to do, so the gap on pages is optz's per-request work (routing, middleware, headers),
  which is where an optimization would go.
- **Bytes: optz sends less.** It serves brotli: 2,315 bytes for `/`, against nginx's gzip 2,849
  (this nginx has no brotli module). For a visitor on a phone, fewer bytes matter more than
  server microseconds.
- **Memory: C wins.** 12 MB for nginx against ~46 MB for Bun. On the 2 GB VPS that's
  irrelevant today (the Rust engine's connections are what need memory), but it's a real
  advantage.
- **The compiled executable runs at the same speed as `optz start`.** `--compile` embeds the
  Bun runtime with your code; it changes how you deploy (one file, nothing to install), not how
  fast it runs.

## Where native code does pay off

- **The social feed** is already native: the Rust engine on raw io_uring and SQLite
  (`portfolio/engine`), because that's per-request work with real computation and a database.
  See [MEASUREMENTS.md](MEASUREMENTS.md).
- **Dynamic page rendering** (React rendering per request) is the one part of the site where
  JavaScript is the cost. optz keeps it off the hot path instead: pages are static or
  client-rendered, dynamic ones are streamed and cached, and `features.dynamic: false` keeps the
  renderer from even loading.
- **TLS and HTTP/2/3**: put nginx (or a CDN) in front. `optz nginx` generates that config, and it
  serves `/assets/` from disk with nginx, which is where its small footprint helps.

## What compiling to C would cost

Rewriting the site in C (or generating C from React components) would give up hot reload,
islands, typed routes and APIs, Server Actions and the rest of the framework, add memory-safety
risk to code that parses untrusted input, and make every change slower to write. All for a
throughput gain of 20-30% on static pages, which a CDN or `optz nginx` serving `/assets/`
already covers where it matters. The engine shows where native code is worth it.
