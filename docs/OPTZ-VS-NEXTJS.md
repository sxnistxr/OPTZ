# optz vs Next.js

The same site built twice: `portfolio/` on optz and `bench/nextjs-portfolio/` on Next.js 16.4.3
(App Router, Turbopack, React 19.3.1). Pages, components, Tailwind CSS, security headers, the blog
API and the proxy to the Rust engine are equivalent; the components are the same files with
`"use client"` and `next/link` in place of islands and `optz`'s `Link`.

Reproduce everything below with `bash bench/compare.sh` (after `npm ci` in
`bench/nextjs-portfolio`). Raw numbers: [`bench/results.json`](../bench/results.json).

## Speed

A 4-vCPU Linux container. Each server is **pinned to one core** with `taskset -c 0`, the same
budget as the $12 VPS. wrk runs on the other three cores: 3 threads, 64 connections, 10 s per
URL, `Accept-Encoding: br, gzip` like a browser. Both are in production mode (`optz start`,
`next start`), with no nginx in front of either.

| URL | what it is | optz req/s | Next req/s | optz p99 | Next p99 |
|---|---|---:|---:|---:|---:|
| `/` | static page, 2 islands / 2 client components | **58,226** | 401 | 3.3 ms | 1.23 s |
| `/blog/<slug>` | static page from Markdown | **56,200** | 477 | 3.5 ms | 1.07 s |
| `/api/blog` | JSON, cached 300 s | **50,962** | 570 | 3.4 ms | 869 ms |
| `/social/post/1` | page whose data loads in the browser | **56,450** | 160 | 3.3 ms | 1.47 s |
| `/nope` | 404 page | **56,445** | 629 | 3.0 ms | 637 ms |

On one core, optz serves 100–350× more requests per second, with tail latency in milliseconds
rather than seconds. Two checks to make sure Next wasn't handicapped by the setup:

- Every Next page above is a cache `HIT` and `x-nextjs-prerender: 1`, so they're prerendered
  pages, not renders.
- Next's best case is with `proxy.ts` removed and no compression: **1,033 req/s** for `/`, and
  718 req/s at 8 connections instead of 64. Most of its cost is the request pipeline itself, not
  gzip or the proxy.

`/social/post/[id]` is where the designs differ most. optz serves one prebuilt shell for every
id (`render: "client"`), so it costs the same as a static page. Next has no equivalent, so the
route renders on every request (`ƒ` in its build output). `generateStaticParams = () => []`
would make Next cache each id after its first request instead, at about its static-page rate.

| | optz | Next | |
|---|---:|---:|---|
| Build | **0.5 s** | 9.3 s | clean build, same machine |
| Cold start to first 200 | **44 ms** | 610 ms | process start until `/` answers |
| First hit of the 5 URLs (sum) | **16 ms** | 172 ms | Next loads route code lazily |
| Memory, idle | **35 MB** | 141 MB | RSS, process tree |
| Memory, peak under load | **44 MB** | 323 MB | RSS during the runs above |
| Response bytes, `/` | **1,553** | 3,431 | brotli/gzip as sent |
| Build output | **300 KB** | 41 MB | `dist/` vs `.next/` |
| Framework on disk | **148 KB** source | 307 MB | `framework/src` vs `next` + `@next` |

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
The 2.9 KB on blog pages is the HTML-swap navigation with hover prefetch. With
`client.runtime: "react"`, the pages with islands cost about 64 KB in optz (see
[MEASUREMENTS.md](MEASUREMENTS.md)).

### What this means on the $12 VPS

At ~400 req/s per core, Next would need a CDN or nginx cache in front of it to handle a spike.
optz handles ~56k req/s on the same core, and 44 MB peak memory leaves the rest of the 2 GB for
the Rust engine and its connections. Neither number is what end users see through the internet;
both are what the server can sustain before it becomes the bottleneck.

## Features

✅ built in · ◐ partly, or with extra work · ❌ not available

### Routing and rendering

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| File-based routes | ✅ `app/routes/blog/[slug].tsx` | ✅ `app/blog/[slug]/page.tsx` | |
| Dynamic, catch-all and group segments | ✅ `[id]`, `[...rest]`, `(group)` | ✅ also `[[...optional]]` | |
| Nested layouts | ✅ `_layout.tsx` | ✅ `layout.tsx` | |
| Error boundary and 404 page | ✅ `_error.tsx`, `_404.tsx` | ✅ `error.tsx`, `not-found.tsx` | |
| `loading.tsx`, parallel and intercepting routes | ❌ | ✅ | |
| Static generation | ✅ default, `paths()` for params | ✅ default, `generateStaticParams` | |
| Server rendering per request | ✅ `render: "dynamic"` | ✅ | |
| One static shell for any param (client-rendered) | ✅ `render: "client"` | ❌ renders per request or per id | |
| Server-only data loading | ✅ `loader`, stripped from browser bundles | ✅ async server components | |
| React Server Components, streaming, Suspense on the server | ❌ | ✅ | the main thing Next has that optz doesn't |
| Server Actions | ❌ use typed API routes | ✅ | |
| Incremental regeneration | ◐ response cache with stale-while-revalidate | ✅ ISR, `revalidatePath`/`revalidateTag` | optz has no on-demand invalidation API |
| Redirects and not-found from loaders | ✅ `redirect()`, `notFound()` | ✅ same names | |
| Head and metadata | ✅ `head()` per page and layout | ✅ `metadata`, `generateMetadata`, OG images | |
| Static export | ✅ `optz export`, with rewrites printed for client routes | ✅ `output: "export"` | |

### Browser JavaScript

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| Pages without JS | ✅ default (islands mode) | ❌ framework runtime always ships | 2.9 KB vs 145 KB above |
| Partial hydration (islands) | ✅ `*.island.tsx` | ◐ client components hydrate; the runtime still loads | |
| Hydrate on load, idle or visible | ✅ `export const hydrate = "visible"` | ❌ use `next/dynamic` + your own observer | |
| Preact runtime option | ✅ `client.runtime: "preact"` | ❌ | |
| Client-side navigation | ✅ HTML swap (islands) or React router (SPA) | ✅ RSC router | |
| Prefetch | ✅ on hover/focus/touch | ✅ in viewport and on hover | |
| `useParams`, `useRouter`, `Link` | ✅ | ✅ | |
| Whole-app SPA mode | ✅ `client.mode: "spa"` | ◐ via client components everywhere | |
| Image optimization | ❌ | ✅ `next/image` | |
| Font optimization | ❌ | ✅ `next/font` | |
| Script loading strategies | ❌ | ✅ `next/script` | |

### Type safety

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| Typed `Link` hrefs | ✅ generated registry | ✅ `typedRoutes` | |
| Typed page params | ✅ `PageProps<Data, "/blog/[slug]">` | ✅ `PageProps<"/blog/[slug]">` | |
| Typed API client from route files | ✅ `api("/api/posts/[id]")` returns the handler's type | ❌ | Next types neither route-handler responses nor fetch calls to them |
| Typed request bodies | ✅ `handler()` + `HandlerContext<P, Body>` | ❌ | |
| Wrong route, method, param or body is a compile error | ✅ checked by `optz check` | ◐ only route strings in `Link`/`router` | |
| Typed config with docs on hover | ✅ | ✅ | |

### Server, APIs and middleware

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| API routes | ✅ `app/api/*.ts`, `GET`/`POST`/… exports | ✅ `route.ts` | |
| Middleware | ✅ chain, `ctx.locals` typed and passed to loaders/APIs | ✅ `proxy.ts`, one function | |
| Strict CSP with no `'unsafe-inline'` on static pages | ✅ boot data is a JSON script | ❌ needs nonces, which make every page dynamic | |
| Proxy a path prefix to another server | ✅ `proxy` in config | ✅ `rewrites` | |
| In-memory response cache: LRU, SWR, merged misses | ✅ `cache = { maxAge, staleWhileRevalidate }` | ◐ data cache + ISR, file-system based | |
| ETag / 304 | ✅ static and dynamic | ✅ | |
| Pre-compressed brotli + gzip | ✅ at build time | ❌ gzip per request | |
| Hashed, immutable assets | ✅ | ✅ | |
| nginx config generator, micro-cache for proxied APIs | ✅ `optz nginx` | ❌ | |
| Request body and idle limits in config | ✅ | ◐ | |
| Edge runtime | ❌ | ✅ | |
| i18n routing | ❌ | ◐ via proxy | |
| Draft mode | ❌ | ✅ | |

### Cost controls

| feature | optz | Next.js |
|---|:---:|:---:|
| Turn features off in config (dynamic rendering, middleware, API, cache, compression, ETags) | ✅ `features.*` | ❌ |
| Server renderer not loaded when no page needs it | ✅ `features.dynamic: false`, ~13 MB less | ❌ |
| Cache bounds (entries, bytes) | ✅ `cache.maxEntries`, `maxBytes` | ◐ `cacheMaxMemorySize` |

### Tooling

| feature | optz | Next.js | notes |
|---|:---:|:---:|---|
| Dev server with reload | ✅ restarts and reloads on save | ✅ Turbopack HMR with state kept | Next's is better for large apps |
| Tailwind CSS | ✅ built in | ✅ via PostCSS | |
| `$lib`-style imports | ✅ `$lib/*`, `$components/*` | ✅ tsconfig `paths` | |
| Type-check command | ✅ `optz check` (route types + tsc) | ✅ during `next build` | |
| Project starter | ✅ `optz create` | ✅ `create-next-app` | |
| Runtime | Bun | Node.js (Bun works) | |
| Ecosystem, docs, hosting integrations | small, this repo | large | |

## When to pick which

**optz**: content sites, blogs, dashboards and apps where most pages are static or load their
data in the browser, on small servers, or wherever memory and requests per core matter.

**Next.js**: apps built around server components, streaming and Server Actions, apps that need
image/font optimization, on-demand revalidation or the edge, and teams that want the ecosystem
and managed hosting.
