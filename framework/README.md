# optz

A small, fast React framework for Bun. File routes, nested layouts, loaders, typed API routes,
middleware, a response cache and `$lib` imports. Pages are **HTML by default**: only the
components you mark as islands ship JavaScript.

```sh
bun framework/src/cli.ts create apps/my-app   # a starter that shows every feature once
cd apps/my-app && bun install
bun run dev      # http://127.0.0.1:3001, rebuilds and reloads the browser on save
bun run check    # generate route types + type-check everything
bun run build    # dist/
bun run start    # production server (PORT/HOST env vars override the config)
optz nginx       # nginx config generated from optz.config.ts
optz export      # static site only, for any static host
```

## Project layout

```
optz.config.ts          one typed config: client mode, feature switches, cache, limits, proxies
app/
  routes/               pages, one file per URL
  api/                  API routes, under /api
  components/           components; *.island.tsx ones hydrate in the browser
  lib/                  shared code ($lib/...)
  middleware.ts         runs before every page and API request
  styles.css            Tailwind CSS v4 (`@import "tailwindcss";`)
public/                 copied as-is
.optz/types.d.ts        generated: your routes and APIs as types
```

## Pages (`app/routes`)

| file | URL |
|---|---|
| `index.tsx` | `/` |
| `blog/[slug].tsx` | `/blog/:slug` |
| `docs/[...rest].tsx` | `/docs/*` |
| `(group)/pricing.tsx` | `/pricing` (brackets group files without a URL segment) |
| `_layout.tsx`, `_error.tsx`, `_404.tsx` | nested layout, error boundary, not-found page |

```tsx
import { Link, notFound, redirect, type LoaderContext, type PageProps } from "optz";

export const config = { render: "static" } as const;   // "static" (default) | "client" | "dynamic"
export const paths = () => [{ slug: "hello" }];         // static pages with params: what to build
export const loader = ({ params }: LoaderContext<{ slug: string }>) => getPost(params.slug) ?? notFound();
export const head = (post: Post) => ({ title: post.title, description: post.summary });
export const cache = { maxAge: 60, staleWhileRevalidate: 600 };   // dynamic pages: response cache

export default function Page({ data, params }: PageProps<Post, "/blog/[slug]">) {
  return <Link href="/blog">Back</Link>;   // href is checked against your routes
}
```

| render | when | per-request cost |
|---|---|---|
| `static` | content known at build time | a memory lookup |
| `client` | data comes from an API in the browser (feeds, dashboards) | a memory lookup |
| `dynamic` | needs the request (cookies, headers) or fresh server data | a React render (cache it with `cache`) |

`loader`, `paths` and `cache` run on the server only. They and the imports only they use are
never sent to the browser.

## Islands: the payload optimization

In `client.mode: "islands"` (the default), a page is just HTML. A component in a file named
`*.island.tsx` is an island: it renders to HTML on the server and **only it** hydrates in the
browser. A page with no islands ships no React at all.

```tsx
// app/components/Counter.island.tsx
export const hydrate = "visible";   // "load" (default) | "idle" | "visible"
export default function Counter({ start }: { start: number }) { ... }
```

- Props must be JSON. Islands inside islands render inline; the outer one owns them.
- `useParams()`, `useRouter()` and `<Link>` work inside islands.
- `client.navigation` swaps page HTML on link clicks (~2 KB) with prefetch on hover, so
  navigation stays instant without hydrating whole pages.
- `client.runtime: "preact"` hydrates islands with Preact (~4 KB) instead of React (~60 KB).
  You still write React; it's aliased through `preact/compat` in browser bundles only.

Measured on the portfolio (JS per page load, compressed / parsed):

| page | SPA + React | islands + React | islands + Preact |
|---|---:|---:|---:|
| home (2 islands) | 66.6 / 208 KB | 64.0 / 210 KB | **14.5 / 18 KB** |
| blog post (no islands) | 63.1 / 208 KB | 3.3 / 5.5 KB | **2.9 / 5.6 KB** |

`client.mode: "spa"` hydrates whole pages and uses the React router instead, if you want that.

## API routes (`app/api`), typed end to end

```ts
// app/api/posts/[id].ts  ->  /api/posts/:id
import { handler, json, type ApiContext, type HandlerContext, type RouteCache } from "optz";

export const cache: RouteCache = { maxAge: 30, staleWhileRevalidate: 300 };  // GETs, in memory
export const GET = ({ params }: ApiContext<{ id: string }>) => json({ id: params.id, likes: 3 });
export const POST = handler(async ({ params, body }: HandlerContext<{ id: string }, { text: string }>) =>
  json({ saved: (await body()).text }, { status: 201 }));
```

```ts
import { api } from "optz";
const post = await api("/api/posts/[id]", { params: { id: "7" } });   // post.likes: number
await api("/api/posts/[id]", { method: "POST", params: { id: "7" }, body: { text: "hi" } });
await api("/api/nope");   // type error: no such route
```

## Middleware

```ts
// app/middleware.ts: one function or an array, run in order
export default defineMiddleware(async (ctx, next) => {
  ctx.locals.user = await userFrom(ctx.request);   // seen by dynamic loaders and API routes
  const res = await next();
  res.headers.set("X-Frame-Options", "DENY");
  return res;
});
```

Type `ctx.locals` with `declare module "optz/types" { interface Locals { user?: User } }`.

## Config

Every option is typed and documented on hover in `optz.config.ts`. The ones that change cost:

| option | default | effect |
|---|---|---|
| `client.mode` | `"islands"` | `"spa"` hydrates whole pages (more JS) |
| `client.runtime` | `"react"` | `"preact"`: ~60 KB less JS on pages with islands |
| `client.navigation` / `prefetch` | on | HTML-swap navigation / prefetch on hover |
| `features.dynamic` | on | off: dynamic pages are a build error and React's server renderer never loads (~13 MB less memory) |
| `features.cache` | on | the in-memory response cache |
| `features.middleware`, `api` | on | skip loading them entirely |
| `features.dynamicCompression`, `etag` | on | gzip and 304s for dynamic responses |
| `features.requestLog` | off | one log line per request |
| `cache.maxEntries` / `maxBytes` / `default` | 500 / 32 MB / none | cache bounds, and a default for routes without `cache` |
| `server.idleTimeout` / `maxRequestBodySize` | 30 s / 1 MB | connection and body limits |
| `proxy[prefix].cacheSeconds` | 0 | nginx micro-cache for a proxied API (via `optz nginx`) |

## Caching, three layers

1. **Built pages and assets** are in memory, pre-compressed with brotli and gzip, with ETags.
   Assets are hashed and `immutable`.
2. **The response cache** holds dynamic pages and API GETs that set `cache`. Fresh entries come
   from memory, stale ones within `staleWhileRevalidate` are served while one request
   refreshes them, and concurrent misses share a single render. It's bounded by entries and bytes.
   Responses with cookies, errors or `no-store` are never stored. Measured:
   `/api/blog` goes from 2.2k to 47–53k req/s on one core.
3. **nginx**: `optz nginx` emits `s-maxage`-aware proxying, `/assets/` from disk, and an
   optional micro-cache per proxied API.

## Measured (one core, local)

Static pages ~58–64k req/s, assets ~75k req/s, cached API ~50k req/s. Memory: ~30 MB idle,
~45 MB under load with `features.dynamic: false`.

## Tests

`bun test` in `framework/`: route scanning and matching, API routes, the cache (fresh, stale,
coalescing, never-store rules, eviction, vary) and island markup.
