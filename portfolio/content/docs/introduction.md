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
| `apps/fullstack/` | Accounts, SQLite sessions, private notes/files and SSE; native forms work without JavaScript |
| `apps/auth/` | Verified accounts, passkeys/MFA and optional status, analytics and direct-upload examples |
| `packages/` | Optional auth, status, analytics, uploads and database integrations |
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
  third of the memory idle in the recorded historical workload. These figures do not measure
  database-backed requests or the current redesigned pages.
- It still has what an app needs: streaming, Server Actions, incremental static regeneration,
  typed routes and APIs, i18n, image and font optimization, Open Graph images, and it deploys as
  a Bun server, a single executable or an edge worker.
- OPTZ 0.4 adds opt-in sessions, SQLite migrations, validation, request-security helpers, private
  uploads, SSE and observation. These do not initialize on the public static path.
- Optional packages extend applications with authentication, status/incident pages, consent-based
  analytics and S3-compatible uploads. Doppler contracts validate configuration at process startup.
  Provider SDKs stay on the server and browser helpers load only where imported.
- The site deploys to a **$1.50 VPS** (one CPU, 2 GB of memory) from an explicitly reviewed
  checkout. Health checks roll an unhealthy release back; the old branch-polling timer is retired.

## Where to go next

- [Getting started](/docs/getting-started): run the site and make a new app.
- [Framework reference](/docs/framework): everything optz does, with examples.
- [Build a full-stack app](/docs/full-stack): accounts, private data and native forms.
- [Application APIs](/docs/application-apis): all seven new opt-in modules.
- [Optional modules](/docs/modules): status, analytics, object storage, caching and database adapters.
- [Environment and Doppler](/docs/doppler): typed contracts, secret management and production setup.
- [Architecture and tech](/docs/architecture): how it's built, and with what.
- [Contributing](/docs/contributing): work on optz itself, the tests and the release flow.
- [Why optz](/docs/why-optz): what it's good at, measured, and when to pick something else.
