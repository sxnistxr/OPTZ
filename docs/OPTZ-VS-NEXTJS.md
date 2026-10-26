# optz vs Next.js

The same site built twice: `portfolio/` on optz and `bench/nextjs-portfolio/` on Next.js 16.4.3
(App Router, Turbopack, React 19.3.1). Pages, components, Tailwind CSS, security headers, the blog
API and the proxy to the Rust engine are equivalent; the components are the same files with
`"use client"` and `next/link` in place of islands and `optz`'s `Link`.

Every Next.js feature optz didn't have is now built in (see [Features](#features)), and
`apps/features/` uses all of them in one app, checked by a 22-step browser suite (`e2e.cjs`)
that passes on the Bun server, the single executable and the edge worker in `workerd`.

The numbers below were measured on the site as it was before it became dihlabs.lol (commit
`9a312d6`, when it still had the social feed); `bench/nextjs-portfolio` is a port of that version.
`compare.sh` now compares the URLs both versions still share.

Reproduce the numbers with `bash bench/compare.sh` (after `npm ci` in `bench/nextjs-portfolio`).
Raw numbers: [`bench/results.json`](../bench/results.json).

## Speed

A 4-vCPU Linux VM. Each server is **pinned to one core** with `taskset -c 0`, the same budget as
the VPS the site runs on. wrk runs on the other three cores: 3 threads, 64 connections, 10 s per URL,
`Accept-Encoding: br, gzip` like a browser. Both are in production mode (`optz start`,
`next start`), with no nginx in front of either. Measured 2026-10-26, after adding all the
features below.

| URL | what it is | optz req/s | Next req/s | optz p99 | Next p99 |
|---|---|---:|---:|---:|---:|
| `/` | static page, 2 islands / 2 client components | **56,636** | 389 | 3.7 ms | 1.24 s |
| `/blog/<slug>` | static page from Markdown | **54,567** | 501 | 3.3 ms | 994 ms |
| `/api/blog` | JSON, prerendered at build time | **55,035** | 577 | 17 ms | 1.01 s |
| `/social/post/1` | page whose data loads in the browser | **56,185** | 158 | 3.4 ms | 1.46 s |
| `/nope` | 404 page | **50,334** | 615 | 20 ms | 553 ms |

On one core, optz serves about 100× more requests per second (350× on `/social/post/[id]`), with
tail latency in milliseconds rather than seconds. Two checks that Next wasn't handicapped by the
setup:

- Every Next page above is a cache `HIT` with `x-nextjs-prerender: 1`: prerendered pages, not renders.
- Next's best case, with `proxy.ts` removed and no compression, is **1,033 req/s** for `/`. Most of
  its cost is the request pipeline itself, not gzip or the proxy.

`/social/post/[id]` is where the designs differ most. optz serves one prebuilt shell for every
id (`render: "client"`), so it costs the same as a static page. Next renders the route on every
request (`ƒ` in its build output); `generateStaticParams = () => []` would make it cache each id
after its first request instead, at about its static-page rate.

| | optz | Next | |
|---|---:|---:|---|
| Build | **1.8 s** | 9.5 s | clean build; optz's includes downloading fonts and rendering 2 OG images |
| Cold start to first 200 | **74 ms** | 692 ms | process start until `/` answers |
| First hit of the 5 URLs (sum) | **3 ms** | 185 ms | Next loads route code lazily |
| Memory, idle | **35 MB** | 140 MB | RSS, process tree |
| Memory, peak under load | **52 MB** | 333 MB | RSS during the runs above |
| Response bytes, `/` | **1,495** | 3,431 | brotli/gzip as sent |
| Framework on disk | **~220 KB** source | 307 MB | `framework/src` vs `next` + `@next` |

### JavaScript sent to the browser

Cold load in Chromium, all scripts, compressed as transferred:

| page | optz (islands + Preact) | Next |
|---|---:|---:|
| `/` (live status + feed) | **14.5 KB** | 144.6 KB |
| `/blog` (no interactivity) | **2.9 KB** | 144.6 KB |
| `/blog/<slug>` (no interactivity) | **2.9 KB** | 144.6 KB |
| `/social` (token, compose, feed) | **14.7 KB** | 144.6 KB |
| `/social/post/1` | **13.1 KB** | 147.2 KB |

Next ships React, its router and the RSC runtime on every page, including pages with no client
components. optz pages are HTML; only islands hydrate, with Preact (`client.runtime: "preact"`).
The 2.9 KB on blog pages is the HTML-swap navigation with hover prefetch.

### What this means on the VPS

At ~400 req/s per core, Next needs a CDN or nginx cache in front of it to survive a spike. optz
handles ~55k req/s on the same core, and 52 MB peak memory leaves the rest of the 2 GB for the
Rust engine and its connections. Whether native code would be faster still is measured in
[NATIVE.md](NATIVE.md) (short answer: no, not for this site).

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
