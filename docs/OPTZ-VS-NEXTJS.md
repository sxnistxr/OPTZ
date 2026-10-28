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

## Speed

A 4-vCPU cloud VM (Intel Xeon @ 2.80 GHz, shared), Linux 6.18, Bun 1.4.4, Node 22.22, Next.js
16.4.3. Each server is **pinned to one core** with `taskset -c 0`, the budget of the VPS the site
runs on; wrk 4.1 runs on the other three: 3 threads, 64 connections, 10 s per URL,
`Accept-Encoding: br, gzip`, **3 runs per URL, median shown**. Both are in production mode
(`optz start`, `next start`), no nginx in front. Measured 2026-10-27.

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
  audit on a 12-core desktop with a different load generator measured 45–59×). The ratio is the
  stable part; treat any single req/s figure as this machine's.
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

✅ built in · ◐ partly · ❌ not available

### Routing and rendering

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| File-based routes, nested layouts | ✅ `app/routes`, `_layout.tsx` | ✅ `app/**/page.tsx`, `layout.tsx` | |
| Dynamic, catch-all, optional catch-all, groups | ✅ `[id]`, `[...rest]`, `[[...rest]]`, `(group)` | ✅ same | |
| Error boundary, 404 page | ✅ `_error.tsx` (also during SSR: status 500), `_404.tsx` | ✅ `error.tsx`, `not-found.tsx` | |
| Loading UI | ✅ `_loading.tsx` | ✅ `loading.tsx` | Suspense fallback while the page streams |
| Parallel routes | ✅ `@slot` folders, `default.tsx` | ✅ same | optz: islands mode |
| Intercepting routes | ✅ `(.)x`, `(..)x`, `(...)x` | ✅ same | e.g. a photo opens as a modal from the feed |
| Static generation | ✅ default, `paths()` | ✅ default, `generateStaticParams` | |
| Server rendering per request | ✅ `render: "dynamic"` | ✅ | |
| Streaming SSR, Suspense, async server components | ✅ | ✅ | optz streams dynamic pages; static pages wait for every boundary at build |
| One static shell for any param | ✅ `render: "client"` | ❌ | Next renders per request or per id |
| Incremental static regeneration | ✅ `export const revalidate` | ✅ | stale copy served while one render rebuilds |
| On-demand revalidation | ✅ `revalidatePath`, `revalidateTag` | ✅ same | |
| Unlisted params rendered on demand | ✅ `dynamicParams = true` | ✅ same | |
| Draft mode | ✅ `draftMode()`, signed cookie | ✅ | |
| `redirect()`, `notFound()` | ✅ | ✅ | |
| Static export | ✅ `optz export` | ✅ `output: "export"` | |
| RSC wire format, client router cache, Partial Prerendering, `"use cache"` | ❌ | ✅ | optz navigates by fetching HTML and keeps unchanged islands mounted instead |

### Data and mutations

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| Server-only data loading | ✅ `loader` or async components | ✅ async server components | |
| Server Actions | ✅ `"use server"` modules | ✅ | |
| Forms that work without JavaScript | ✅ `<form action={fn}>`, `fn.bind(null, id)` | ✅ | |
| Refresh after a mutation | ✅ action calls `revalidatePath` → the page updates in place | ✅ | islands keep their state |
| `cookies()`, `headers()`, `after()` | ✅ `optz/server` | ✅ `next/headers`, `next/server` | |
| Typed API client from route files | ✅ `api("/api/posts/[id]")` | ❌ | wrong route, method, param or body is a compile error |
| API routes | ✅ `app/api/*.ts` | ✅ `route.ts` | |
| Prerendered API routes | ✅ `export const prerender = true` | ✅ static route handlers | |
| In-memory response cache (LRU, SWR, merged misses) | ✅ `cache = { maxAge, staleWhileRevalidate, tags }` | ◐ data cache + ISR | |

### Browser JavaScript and assets

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| Pages without JS | ✅ default (islands mode) | ❌ | 2.9 KB vs 145 KB above |
| Partial hydration, on load / idle / visible | ✅ `*.island.tsx`, `export const hydrate` | ◐ client components; the runtime always loads | |
| Preact runtime option | ✅ `client.runtime: "preact"` | ❌ | |
| Client navigation with prefetch | ✅ | ✅ | |
| Image optimization | ✅ `<Image>` + `/_optz/image` (AVIF/WebP, resize, cache) | ✅ `next/image` | needs `sharp`; edge workers serve originals |
| Font optimization | ✅ `fonts` in config: self-hosted Google Fonts, preload, size-matched fallbacks | ✅ `next/font` | Next also has `next/font/local` |
| Script loading strategies | ✅ `<Script strategy>` | ✅ `next/script` | no inline scripts (strict CSP), no web-worker strategy |
| Strict CSP with no `'unsafe-inline'` | ✅ static pages need nothing; streamed pages get a nonce automatically | ◐ needs nonces, which make every page dynamic | |
| Pre-compressed brotli + gzip | ✅ at build time | ❌ gzip per request | |

### Metadata and SEO

| feature | optz | Next.js |
|---|:---:|:---:|
| Title, description, canonical, robots, Open Graph, Twitter cards | ✅ `head()` | ✅ `metadata` |
| Open Graph images from components | ✅ `page.og.tsx` (PNG at build time) | ✅ `opengraph-image.tsx` |
| `sitemap.xml`, `robots.txt`, web manifest from code | ✅ `app/sitemap.ts`, `robots.ts`, `manifest.ts` | ✅ same |
| hreflang alternates | ✅ automatic with i18n | ✅ `alternates` |

### Deployment and runtime

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| i18n routing | ✅ `i18n` in config: prefixes, Accept-Language detection, localized links | ◐ App Router: by hand in `proxy.ts` | |
| Middleware | ✅ chain, typed `ctx.locals` | ✅ `proxy.ts` | |
| Edge runtime | ✅ `optz build --target edge`: the whole app as one worker | ✅ per route | tested in Cloudflare's `workerd` |
| Single-file deploy | ✅ `optz build --compile`: one executable | ◐ `output: "standalone"` (a folder + Node) | |
| nginx config generator, micro-cache for proxied APIs | ✅ `optz nginx` | ❌ | |
| Turn features off for less memory per request | ✅ `features.*` | ❌ | |

### Tooling

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| Dev server with state-preserving updates | ✅ Fast Refresh for islands, CSS swap, page HTML updated in place | ✅ Fast Refresh | optz restarts the server process on each change (~0.3 s) |
| Tailwind CSS | ✅ built in | ✅ via PostCSS | |
| Type-check command, typed routes | ✅ `optz check` | ✅ `typedRoutes` + `next build` | |
| Project starter | ✅ `optz create` | ✅ `create-next-app` | |
| Runtime | Bun | Node.js | |
| Ecosystem, docs, hosting integrations | small, this repo | large | |

## When to pick which

**optz**: content sites, blogs, dashboards and apps where most pages are static or load their
data in the browser; small servers; anywhere requests per core, memory and JavaScript per page
matter. It now covers the Next.js feature set an app like this needs.

**Next.js**: apps that lean on the RSC wire format (client router cache, Partial Prerendering,
`"use cache"`), very large codebases that benefit from Turbopack, and teams that want the
ecosystem, documentation and managed hosting around it.
