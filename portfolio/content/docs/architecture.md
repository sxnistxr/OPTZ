# Architecture and tech

How optz and this site are built, from a source file to a byte on the wire, and the tools
underneath.

## The stack

| layer | technology | why |
|---|---|---|
| Runtime | [Bun](https://bun.sh) 1.4 | Native HTTP server, bundler, TypeScript and JSX without a build step, fast startup |
| UI | React 19 (server), Preact 11 or React in the browser | React's server renderer and streaming; Preact keeps islands at ~4 KB |
| Language | TypeScript, checked with TypeScript 7 (`tsgo`) | Typed routes, params, API responses and request bodies |
| Styling | Tailwind CSS v4 | Compiled to one hashed stylesheet at build time |
| Content | Markdown via `marked` | Blog posts and these docs, rendered at build time |
| Images | sharp (libvips) | AVIF/WebP resizing behind `/_optz/image` |
| Open Graph images | satori + resvg | JSX to SVG to PNG at build time |
| Backend (engine) | Rust, raw io_uring, SQLite (WAL) | The $12 Server Challenge entry: one core, 2 GB, as many users as possible |
| Serving | nginx in front, systemd units | TLS and buffering; config generated from `optz.config.ts` |
| Tests | `bun test`, Playwright (Chromium), Cloudflare `workerd` | Unit, in-process app and browser checks on every deploy target |

## A request, from the wire to the response

```
nginx :80/:443
  ├─ /assets/*                  from disk (immutable, pre-compressed)
  └─ everything else            → Bun on 127.0.0.1:3001 (optz start)
        handler.fetch(request)
          ├─ /assets/*          in-memory file, no middleware
          ├─ proxy prefixes     forwarded (config.proxy)
          └─ middleware chain   app/middleware.ts
               └─ route()
                    ├─ static page      → memory lookup (brotli/gzip/ETag precomputed)
                    ├─ client shell     → memory lookup (one HTML for every param value)
                    ├─ ISR page         → memory lookup; stale? one background re-render
                    ├─ dynamic page     → React render, streamed (or from the response cache)
                    ├─ API route        → your handler (GET responses cacheable)
                    └─ /_optz/action    → a Server Action
```

The handler (`framework/src/handler.ts`) is web-standard code: a `fetch(Request) => Response`
function. The Bun server, the single executable and the edge worker all run the same function;
only how files and modules are loaded differs.

Static pages are the common case and the cheapest: the build writes HTML plus `.br` and `.gz`
copies; the server loads them into a map at startup with precomputed ETags and headers. Serving
one is a map lookup and building a `Response`, about 3 µs of JavaScript per request. React's
server renderer isn't even loaded unless a page renders per request.

## The build

`optz build` (`framework/src/build.ts`):

1. **Scan** `app/routes` and `app/api` into a route table: params, catch-alls, layouts, error
   and loading boundaries, `@slot` folders, intercepting folders, `*.og.tsx` images.
2. **Generate types** (`.optz/types.d.ts`): every route and API module as a type, so `<Link>`,
   `PageProps` and `api()` are checked against files that exist.
3. **Bundle the browser code** with `Bun.build`: a ~2 KB entry (navigation, island loader) and
   one chunk per island. `"use server"` modules become fetch stubs. With `runtime: "preact"`,
   React imports are aliased to `preact/compat` in browser bundles only.
4. **CSS**: Tailwind compiles `app/styles.css`; self-hosted fonts are downloaded and their
   `@font-face` rules (plus size-matched fallbacks read from the font files) are appended.
5. **Prerender** every static page, client shell, prerendered API route and Open Graph image,
   by sending requests through the same handler that serves production.
6. **Write** `sitemap.xml`, `robots.txt` and `manifest.webmanifest` from `app/*.ts`, and
   compress every text file with brotli (quality 11) and gzip (level 9).

The result is `dist/static` (servable as-is) and `dist/manifest.json` (routes, chunks, render
modes, actions, redirects).

## Islands in the browser

A page is HTML. Each `*.island.tsx` renders on the server inside an `<optz-island>` element with
its props as JSON. In the browser, `framework/src/islands.ts` (no React) finds those elements,
loads each island's chunk when it should (`load`, `idle`, or `visible` via IntersectionObserver)
and hydrates just that element. React (or Preact) arrives with the first island; a page without
islands never downloads it.

Navigation swaps HTML instead of hydrating whole pages: a click fetches the next page (often
already prefetched on hover), replaces `#__optz`, and hydrates the new islands. `refresh()`
(called after Server Actions revalidate) does the same for the current page but keeps every
island whose id and props didn't change mounted, so their state survives.

## Rendering and streaming

`framework/src/render.tsx` builds the document. Static pages use React's `prerender` (every
Suspense boundary resolved, no inline scripts). Dynamic pages use `renderToReadableStream`: the
head and shell go out at once, async components stream in, and React's small inline scripts get
a per-response nonce that the handler adds to your Content-Security-Policy after middleware ran.

## Caching, four layers

1. **Built files** in memory, pre-compressed, with ETags; hashed assets are `immutable`.
2. **Incremental static regeneration**: a static page past its `revalidate` time (or named by
   `revalidatePath`/`revalidateTag`) is served stale while one background render replaces it.
3. **The response cache** (`cache.ts`) for dynamic pages and API GETs: LRU bounded by entries
   and bytes, stale-while-revalidate, concurrent misses share one render, tags.
4. **nginx**: `optz nginx` adds `s-maxage`-aware proxying and per-prefix micro-caching.

## Server Actions

At build time, every module under `app/` that starts with `"use server"` gets an id. Browser
bundles get stubs that POST JSON (or FormData) to `/_optz/action/<id>/<name>`; on the server the
real module runs inside the request context (`cookies()`, `headers()`, `revalidatePath()`). The
server also tags each action with React's `$$FORM_ACTION`, so `<form action={fn}>` rendered on the
server is a real form post that works without JavaScript, bound arguments included. Plain form
posts must come from the same origin.

## The dev server

`optz dev` runs a child process that builds (unminified, with React in a stable vendor bundle and
Fast Refresh transforms) and serves. A file change restarts the child (~0.3 s). Open pages keep a
server-sent-events connection; when the new build says hello, the page swaps changed stylesheets,
re-imports changed island chunks and lets React Fast Refresh swap their code (state kept), then
updates the page's HTML in place around them.

## Deploy targets

| target | how |
|---|---|
| Bun server | `dist/` + `optz start`; production runs it under systemd behind nginx |
| Single executable | `optz build --compile`: the Bun runtime, your code and every built file in one binary |
| Edge worker | `optz build --target edge`: one ES module with `export default { fetch }`, files embedded |
| Static | `optz export`: `dist/static` only |

## The framework's source

| file | role |
|---|---|
| `cli.ts` | `optz dev/build/start/check/export/nginx/create` |
| `routes.ts`, `match.ts` | File-system routes, slots and intercepts; matching shared with the browser |
| `build.ts`, `codegen.ts`, `manifest.ts` | The build, generated types, the manifest format |
| `handler.ts` | The request handler (everything per request) |
| `server.ts`, `static.ts`, `cache.ts` | Bun adapter, in-memory files, response cache |
| `render.tsx`, `runtime.tsx` | Document rendering and streaming; router, layouts, `Link`, hooks |
| `island.tsx`, `plugin.ts`, `islands.ts`, `hydrate.tsx` | Islands: server marking, browser runtime |
| `actions*.ts`, `action-client.ts`, `context.ts`, `server-api.ts` | Server Actions and `optz/server` |
| `image*.ts(x)`, `fonts.ts`, `og*.ts`, `seo.ts`, `script*.ts(x)` | Images, fonts, OG images, sitemap/robots, scripts |
| `server-bundle.ts` | Single executable and edge worker |
| `dev.ts`, `dev-client.ts`, `dev-vendor.ts` | Dev server updates and Fast Refresh |
| `nginx.ts`, `create.ts`, `types.ts`, `index.ts` | nginx config, starter app, public types and API |
