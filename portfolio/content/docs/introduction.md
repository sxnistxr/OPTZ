# Introduction

dihlabs.lol is a dev lab by sxnistxr: a place to build software, explore systems,
and write down what happens. This documentation covers
the code behind it: one repository with a web framework, the site built on it, a Rust backend
and everything that deploys them.

## What's in the repository

| folder | what it is |
|---|---|
| `framework/` | **optz**, a React framework for Bun. The site and every app here run on it |
| `portfolio/` | **This site**: pages, Markdown content, API routes and this documentation |
| `portfolio/engine/` | A Rust server on raw io_uring and SQLite, built for the $12 Server Challenge |
| `apps/features/` | Every optz feature in one app, with browser checks |
| `apps/social/` | A small social network over the Rust engine (it used to be on this site) |
| `apps/example/` | The starter `optz create` makes |
| `bench/` | The site ported to Next.js, and the benchmark scripts |
| `ops/`, `deploy/` | Production: systemd units, generated nginx, deploys with rollback, backups, reviewed releases |
| `docs/` | Design notes and measurements |

## The short version

- **optz** renders pages to HTML at build time and ships JavaScript only for the parts marked
  interactive ("islands"). Serving a page is a memory lookup: **tens of thousands of requests
  per second on one CPU core**, about 40–60× Next.js on the same app and core (measured), in a
  third of the memory idle.
- It still has what an app needs: streaming, Server Actions, incremental static regeneration,
  typed routes and APIs, i18n, image and font optimization, Open Graph images, and it deploys as
  a Bun server, a single executable or an edge worker.
- The whole thing runs on a **$1.50 VPS** (one CPU, 2 GB of memory) that pulls this repository
  every 30 seconds, builds it, and rolls back by itself if a release isn't healthy.

## Where to go next

- [Getting started](/docs/getting-started): run the site and make a new app.
- [Framework reference](/docs/framework): everything optz does, with examples.
- [Architecture and tech](/docs/architecture): how it's built, and with what.
- [Contributing](/docs/contributing): work on optz itself, the tests and the release flow.
- [Why optz](/docs/why-optz): what it's good at, measured, and when to pick something else.
