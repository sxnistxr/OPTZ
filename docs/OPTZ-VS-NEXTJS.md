# optz vs Next.js

The same site built twice: `portfolio/` on optz and `bench/nextjs-portfolio/` on Next.js 16.4.3
(App Router, Turbopack, React 19.3.1). Pages, components, Tailwind CSS, security headers, the blog
API and the proxy to the Rust engine are equivalent; the components are the same files with
`"use client"` and `next/link` in place of islands and `optz`'s `Link`.

The selected routing/rendering features below are built in (see [Features](#features)), and
`apps/features/` uses all of them in one app, checked by a browser suite (`e2e.cjs`) that CI
runs, plus the edge worker in `workerd`. Application services and ecosystem coverage differ;
see [full-stack research and roadmap](FULLSTACK-RESEARCH.md).

`bench/nextjs-portfolio` is a port of the site; `bench/compare.sh` measures the URLs both still
share. Every number below comes from one run of that script, saved with its provenance in
[`bench/results.json`](../bench/results.json): commit `ff34e5a` (clean tree), the machine, every
tool's version, the settings, and each individual run. Reproduce with `bash bench/compare.sh`
(after `npm ci` in `bench/nextjs-portfolio`).

## Measurement scope

The network figures below describe the October 27, 2026 commit and page composition, before
the subsequent site redesign and 0.4 application modules. They have not been rerun against
the current logo, documentation, theme or Three.js bundles. Use them as historical evidence,
not as current page-size budgets or authenticated application performance. Newer routing-only
measurements are documented separately in [full-stack design and dispatch benchmarks](FULLSTACK-RESEARCH.md).

## Speed

A 4-vCPU cloud VM (Intel Xeon @ 2.80 GHz, shared), Linux 6.18, Bun 1.4.4, Node 22.22, Next.js
16.4.3. Each server is **pinned to one core** with `taskset -c 0`, the budget of the VPS the site
runs on; wrk 4.1 runs on the other three: 3 threads, 64 connections, 10 s per URL,
`Accept-Encoding: br, gzip`, **3 runs per URL, median shown**. Both are in production mode
(`optz start`, `next start`), no nginx in front. Measured 2026-10-27.

```stats
throughput
```

| URL | what it is | optz req/s | Next req/s | ratio | optz p99 | Next p99 |
|---|---|---:|---:|---:|---:|---:|
| `/` | static page, 2 islands / 2 client components | **26,366** | 438 | 60× | 4.9 ms | 1.25 s |
| `/blog/<slug>` | static page from Markdown | **23,912** | 539 | 44× | 5.8 ms | 582 ms |
| `/api/blog` | JSON, prerendered at build time | **29,041** | 739 | 39× | 4.9 ms | 1.13 s |
| `/nope` | 404 page | **24,478** | 591 | 41× | 5.1 ms | 455 ms |

On one core here, optz serves **about 40–60× more requests per second**, with tail latency in
milliseconds rather than hundreds of milliseconds. How to read that:

- **It's this workload and this machine.** Absolute numbers depend on the CPU (an earlier run on
  a different 4-vCPU VM measured ~56k req/s for optz and ~400–600 for Next, and an independent
  audit on a 12-core desktop with a different load generator measured 45–59×). Neither the absolute
  values nor the ratios are guaranteed on a different workload or machine.
- **Next is serving cached pages, not rendering.** Every Next response measured above carries
  `x-nextjs-cache: HIT` (recorded per URL in `results.json`). Its cost is the request pipeline.
- **Next's runs vary more.** Its three runs on `/` were 360, 438 and 574 req/s; optz's were
  25,954–27,436. All runs are in the JSON.
- **The latency is queueing at saturation.** With 64 connections on one core, p99 mostly
  measures how long a request waits behind the others; it isn't the time one request takes on
  an idle server.
- `/nope` answers 404 on both, so all of its responses count as non-2xx in wrk (the JSON has
  each run's total and non-2xx count, which match).

| | optz | Next | |
|---|---:|---:|---|
| Build (median of 3) | **3.0 s** | 10.3 s | clean `dist/` / `.next`; optz's font downloads were cached (`font_cache: warm`) |
| Cold start to first 200 (median of 5) | **~90 ms** | ~720 ms | process start until `/` answers; ±30 ms between runs |
| Memory, idle | **37 MB** | 131 MB | RSS of the process tree |
| Memory, peak under load | **47 MB** | 331 MB | RSS during the runs above |
| Bytes for `/`: brotli / gzip / none | **2,315 / 2,849** / 9,667 | 13,849 / 3,520 / 13,849 | Next doesn't brotli-compress: with only `br` accepted it sends the page uncompressed |
| Framework installed | **0.4 MB** | 392 MB | the published `optz` package (`src`, skills, README) vs `node_modules/next` + `@next` |

```stats
resources
```

### JavaScript sent to the browser

Measured by `bench/js-per-page.cjs` (part of `compare.sh`): a cold load of each page in Chromium,
every script response, size as transferred and decoded.

| page | optz (islands + Preact) | Next |
|---|---:|---:|
| `/` (live status island) | **12.0 KB** (5 scripts, 30.9 KB decoded) | 141.7 KB (8 scripts, 468 KB decoded) |
| `/blog` (no interactivity) | **4.0 KB** (2 scripts) | 141.7 KB |
| `/blog/<slug>` (no interactivity) | **4.0 KB** (2 scripts) | 141.7 KB |

Next ships React, its router and the RSC runtime on every page, including pages with no client
components. optz pages are HTML; only islands hydrate, with Preact (`client.runtime: "preact"`).
The 4 KB on blog pages is the HTML-swap navigation with hover prefetch and the accessibility
layer (focus and announcements on navigation).

### What this means on the VPS

At a few hundred req/s per core, Next needs a CDN or nginx cache in front of it to survive a
spike; optz handles tens of thousands per core, and ~47 MB peak memory leaves the rest of the
2 GB for the Rust engine and its connections. Whether native code would be faster still is
measured in [NATIVE.md](NATIVE.md).

## Features

Support is explicit: **Built in**, **Partial**, **Unavailable**, or **Integration**.
Integration means application code or an external library/provider is required; it does not
mean the capability is impossible. OPTZ entries reflect the current 0.4 source; performance
figures above remain tied to their historical benchmark commit.

### Routing and rendering

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| File-based routes, nested layouts | [built-in] `app/routes`, `_layout.tsx` | [built-in] `app/**/page.tsx`, `layout.tsx` | |
| Dynamic, catch-all, optional catch-all, groups | [built-in] `[id]`, `[...rest]`, `[[...rest]]`, `(group)` | [built-in] same | |
| Error boundary, 404 page | [built-in] `_error.tsx` (also during SSR: status 500), `_404.tsx` | [built-in] `error.tsx`, `not-found.tsx` | |
| Loading UI | [built-in] `_loading.tsx` | [built-in] `loading.tsx` | Suspense fallback while the page streams |
| Parallel routes | [built-in] `@slot` folders, `default.tsx` | [built-in] same | optz: islands mode |
| Intercepting routes | [built-in] `(.)x`, `(..)x`, `(...)x` | [built-in] same | e.g. a photo opens as a modal from the feed |
| Static generation | [built-in] default, `paths()` | [built-in] default, `generateStaticParams` | |
| Server rendering per request | [built-in] `render: "dynamic"` | [built-in] | |
| Streaming SSR, Suspense, async server components | [built-in] | [built-in] | optz streams dynamic pages; static pages wait for every boundary at build |
| One static shell for any param | [built-in] `render: "client"` | [unavailable] | Next renders per request or per id |
| Incremental static regeneration | [built-in] `export const revalidate` | [built-in] | stale copy served while one render rebuilds |
| On-demand revalidation | [built-in] `revalidatePath`, `revalidateTag` | [built-in] same | |
| Unlisted params rendered on demand | [built-in] `dynamicParams = true` | [built-in] same | |
| Draft mode | [built-in] `draftMode()`, signed cookie | [built-in] | |
| `redirect()`, `notFound()` | [built-in] | [built-in] | |
| Static export | [built-in] `optz export` | [built-in] `output: "export"` | |
| RSC wire format, client router cache, Partial Prerendering, `"use cache"` | [unavailable] | [built-in] | optz navigates by fetching HTML and keeps unchanged islands mounted instead |

### Data and mutations

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| Server-only data loading | [built-in] `loader` or async components | [built-in] async server components | |
| Server Actions | [built-in] `"use server"` modules | [built-in] | |
| Forms that work without JavaScript | [built-in] `<form action={fn}>`, `fn.bind(null, id)` | [built-in] | |
| Refresh after a mutation | [built-in] action calls `revalidatePath` → the page updates in place | [built-in] | islands keep their state |
| `cookies()`, `headers()`, `after()` | [built-in] `optz/server` | [built-in] `next/headers`, `next/server` | |
| Typed API client from route files | [built-in] `api("/api/posts/[id]")` | [unavailable] | wrong route, method, param or body is a compile error |
| API routes | [built-in] `app/api/*.ts` | [built-in] `route.ts` | |
| Prerendered API routes | [built-in] `export const prerender = true` | [built-in] static route handlers | |
| In-memory response cache (LRU, SWR, merged misses) | [built-in] `cache = { maxAge, staleWhileRevalidate, tags }` | [partial] data cache + ISR | |

### Browser JavaScript and assets

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| No hydration runtime on pages without islands | [built-in] HTML by default | [unavailable] React/RSC runtime on measured pages | OPTZ navigation still transfers JS when enabled; historical blog result: 4.0 KiB vs 141.7 KiB |
| Partial hydration, on load / idle / visible | [built-in] `*.island.tsx`, `export const hydrate` | [partial] client components; the runtime always loads | |
| Preact runtime option | [built-in] `client.runtime: "preact"` | [unavailable] | |
| Client navigation with prefetch | [built-in] | [built-in] | |
| Image optimization | [built-in] `<Image>` + `/_optz/image` (AVIF/WebP, resize, cache) | [built-in] `next/image` | needs `sharp`; edge workers serve originals |
| Font optimization | [built-in] `fonts` in config: self-hosted Google Fonts, preload, size-matched fallbacks | [built-in] `next/font` | Next also has `next/font/local` |
| Script loading strategies | [built-in] `<Script strategy>` | [built-in] `next/script` | no inline scripts (strict CSP), no web-worker strategy |
| Strict CSP with no `'unsafe-inline'` | [built-in] static pages need nothing; streamed pages get a nonce automatically | [partial] needs nonces, which make every page dynamic | |
| Pre-compressed brotli + gzip | [built-in] at build time | [unavailable] gzip per request | |

### Metadata and SEO

| feature | optz | Next.js |
|---|:---:|:---:|
| Title, description, canonical, robots, Open Graph, Twitter cards | [built-in] `head()` | [built-in] `metadata` |
| Open Graph images from components | [built-in] `page.og.tsx` (PNG at build time) | [built-in] `opengraph-image.tsx` |
| `sitemap.xml`, `robots.txt`, web manifest from code | [built-in] `app/sitemap.ts`, `robots.ts`, `manifest.ts` | [built-in] same |
| hreflang alternates | [built-in] automatic with i18n | [built-in] `alternates` |

### Deployment and runtime

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| i18n routing | [built-in] `i18n` in config: prefixes, Accept-Language detection, localized links | [partial] App Router: by hand in `proxy.ts` | |
| Middleware | [built-in] chain, typed `ctx.locals` | [built-in] `proxy.ts` | |
| Edge runtime | [built-in] `optz build --target edge`: the whole app as one worker | [built-in] per route | tested in Cloudflare's `workerd` |
| Single-file deploy | [built-in] `optz build --compile`: one executable | [partial] `output: "standalone"` (a folder + Node) | |
| nginx config generator, micro-cache for proxied APIs | [built-in] `optz nginx` | [unavailable] | |
| Turn features off for less memory per request | [built-in] `features.*` | [unavailable] | |

### Tooling

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| Dev server with state-preserving updates | [built-in] Fast Refresh for islands, CSS swap, page HTML updated in place | [built-in] Fast Refresh | optz restarts the server process on each change (~0.3 s) |
| Tailwind CSS | [built-in] built in | [built-in] via PostCSS | |
| Type-check command, typed routes | [built-in] `optz check` | [built-in] `typedRoutes` + `next build` | |
| Project starter | [built-in] `optz create` | [built-in] `create-next-app` | |
| Runtime | Bun | Node.js | |
| Ecosystem, docs, hosting integrations | small, this repo | large | |

### Application services (OPTZ 0.4)

| Capability | OPTZ | Next.js | Notes |
|---|:---:|:---:|---|
| Revocable server-side sessions | [built-in] `optz/sessions`; pluggable store | [integration] application or session library | OPTZ SQLite adapter targets Bun; use shared storage across replicas |
| Local SQLite and versioned migrations | [built-in] `optz/sqlite` | [integration] database library / ORM | OPTZ migrations are transactional and checksum-protected |
| Runtime validation for JSON / forms | [built-in] `optz/forms` | [integration] schema validation in actions / handlers | Standard Schema V1 or a function validator; no bundled schema package |
| Private local attachment storage | [built-in] `optz/storage` | [integration] storage provider / application | Authorization, quotas and content inspection remain app responsibilities |
| Server-sent event responses | [built-in] `optz/stream` | [integration] streaming route handler | OPTZ adds framing validation, event budgets, backpressure and cleanup |
| Request observation hooks | [built-in] `optz/observe` | [built-in] instrumentation APIs | Different APIs; OPTZ adds request IDs, Server-Timing and callbacks |
| Password accounts and private CRUD starter | [built-in] `--template fullstack` | [integration] starter / authentication library | OPTZ starter is executable on Bun and works without browser JS |
| Verified email, recovery, OAuth, passkeys, MFA | [integration] optional `@optz/auth` / Better Auth | [integration] identity provider / auth library | OPTZ includes an executable auth app; neither framework is a hosted identity service |
| Public status and incident timelines | [integration] optional `@optz/status` | [integration] app / service | OPTZ supplies SSR markup, a persistent adapter and authenticated mutations |
| Consent-based analytics / PostHog | [integration] optional `@optz/analytics` | [integration] analytics library / provider | OPTZ includes bounded local insights and an injected PostHog adapter |
| Direct and multipart object uploads | [integration] optional `@optz/uploads` | [integration] storage library / provider | S3-compatible presigning, owner quotas, checksums and immutable approval; configured limit up to 5 GiB |
| Environment validation / Doppler | [integration] `optz/env` and official Doppler CLI | [integration] schema / provider CLI | OPTZ validates before importing app config; explicit public allowlist, no request-time secret fetch |
| ORM session storage | [integration] optional `@optz/db` | [integration] native ORM / auth adapter | Prisma, Drizzle and parameterized Kysely/TypeORM executor recipes; no default ORM |
| Durable jobs and distributed state | [integration] external services | [integration] external services | SSE and response lifecycle hooks do not provide durable work |

See [Application APIs](../portfolio/content/docs/application-apis.md), the
[starter](../portfolio/content/docs/full-stack.md) and Next.js
[authentication guidance](https://nextjs.org/docs/app/guides/authentication) for implementation boundaries.

## When to pick which

**optz**: content sites, blogs, dashboards and apps where most pages are static or load their
data in the browser; small servers; anywhere requests per core, memory and JavaScript per page
matter. The optional Bun/SQLite starter also supports private-data apps; its capabilities and limits
are described above.

**Next.js**: apps that lean on the RSC wire format (client router cache, Partial Prerendering,
`"use cache"`), very large codebases that benefit from Turbopack, and teams that want the
ecosystem, documentation and managed hosting around it.
