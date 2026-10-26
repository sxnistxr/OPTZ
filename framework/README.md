# optz

A small, fast React framework for Bun. File-based routes, nested layouts, loaders, middleware,
API routes and a `$lib` alias, with pages **pre-rendered at build time by default** so the
server has almost nothing to do per request.

```sh
bun framework/src/cli.ts create apps/my-app   # or `optz create` once linked
cd apps/my-app && bun install
bun run dev        # http://127.0.0.1:3001, rebuilds and reloads the browser on save
bun run build      # dist/
bun run start      # production server (PORT/HOST env vars override the config)
optz export        # static site only, for any static host
```

## Project layout

```
optz.config.ts          port, proxy rules, global <head> tags
app/
  routes/               one file per URL (see below)
  middleware.ts         runs before every page, data and API request
  lib/                  shared code, imported as $lib/... (from tsconfig "paths")
  styles.css            Tailwind CSS v4 entry (`@import "tailwindcss";`)
public/                 copied as-is (favicon, robots.txt, images)
```

## Routes

| file in `app/routes` | URL |
|---|---|
| `index.tsx` | `/` |
| `about.tsx` | `/about` |
| `blog/index.tsx` | `/blog` |
| `blog/[slug].tsx` | `/blog/:slug` |
| `docs/[...rest].tsx` | `/docs/*` (`params.rest` = `"a/b/c"`) |
| `(group)/pricing.tsx` | `/pricing`: brackets group files without adding a segment |
| `hello.ts` | `/hello`: an API route |
| `_layout.tsx` | wraps every page in its folder and below (layouts nest) |
| `_error.tsx` | error boundary for pages in its folder and below |
| `_404.tsx` | the not-found page |

`.tsx`/`.jsx` files are pages, `.ts`/`.js` files are API routes. Names starting with `_` are
never routes. Static segments win over `[param]`, and params win over `[...rest]`. Two files
that would match the same URLs are a build error.

## Pages

```tsx
import { Link, notFound, redirect, type LoaderContext, type PageProps } from "optz";

// Optional. "static" (default): rendered at build time. "dynamic": per request.
// "client": one shell for every matching URL; the page fetches its own data.
export const config = { render: "static" } as const;

// Static pages with [params] list what to build.
export const paths = () => [{ slug: "hello" }];

// Runs on the server only: at build time for static pages, per request for dynamic ones.
// It's stripped from browser bundles, along with imports only it uses (fs, secrets).
export const loader = async ({ params, request, locals }: LoaderContext) => {
  const post = await getPost(params.slug);
  if (!post) notFound();                 // -> 404 page
  if (post.moved) throw redirect(post.url, 301);
  return post;
};

export const head = (post: Post) => ({ title: post.title, description: post.summary });

export default function Page({ data, params }: PageProps<Post>) {
  return <Link href="/blog">Back</Link>;
}
```

| choose | when |
|---|---|
| `static` | content known at build time (blog posts, marketing pages). Fastest: served from memory, no React per request |
| `client` | per-user or fast-changing data from an API (a feed, a dashboard). The server does no work per request |
| `dynamic` | needs the request (cookies, headers) or fresh server-side data on every load |

## Navigation and hooks

- `<Link href>`: client-side navigation (no full page load) and prefetch on hover, focus or
  touch. Modified clicks, `target`, `download` and external links behave normally.
- `useRouter()`: `{ pathname, params, navigate(href, { replace, scroll }), prefetch, back, navigating }`
- `useLoaderData()`, `useParams()`, `useNavigating()`

The back and forward buttons restore scroll position, titles and descriptions update on
navigation, and a failed data fetch falls back to a normal page load.

## Middleware

```ts
// app/middleware.ts (export one function, or an array of them to run in order)
import { defineMiddleware } from "optz";

export default defineMiddleware(async (ctx, next) => {
  ctx.locals.user = await userFrom(ctx.request);   // visible to dynamic loaders and API routes
  if (!ctx.locals.user && ctx.url.pathname.startsWith("/admin")) return Response.redirect("/login");
  const res = await next();
  res.headers.set("X-Frame-Options", "DENY");
  return res;
});
```

It runs for pages (static ones too: headers can still be added), data requests and API routes.
It doesn't run for hashed `/assets/*` files or proxied prefixes.

## API routes

```ts
// app/routes/hello.ts
import { json, type ApiHandler } from "optz";
export const GET: ApiHandler = ({ url, params, locals }) => json({ hi: url.searchParams.get("name") });
export const POST: ApiHandler = async ({ request }) => json(await request.json(), { status: 201 });
```

Unsupported methods get a 405 with an `Allow` header.

## Config

```ts
// optz.config.ts
import { defineConfig } from "optz";
export default defineConfig({
  port: 3001,
  hostname: "127.0.0.1",
  proxy: { "/api": { target: "http://127.0.0.1:3000", strip: true } },
  head: { links: [{ rel: "icon", href: "/favicon.svg" }], meta: [{ name: "theme-color", content: "#1b2433" }] },
  lang: "en",
});
```

## What makes it fast

- **Static first.** Pages and their data are rendered once at build time. At startup every
  built file is loaded into memory with brotli and gzip copies and an ETag, so serving a page is
  a map lookup plus content negotiation. Measured on one core: ~50k pages/s and ~75k assets/s.
- **Small browser payloads.** One code-split chunk per page and layout (0.5–2 KB gzipped for
  typical pages), shared React and runtime chunks, `modulepreload` for the current route, and
  hashed asset names served `immutable`.
- **Server code never ships.** `loader` and `paths` are removed from browser bundles, along
  with any imports only they use.
- **Low memory.** ~33 MiB idle and ~44 MiB under load for the example site.
- **Static export.** `optz export` writes a site any static host or nginx can serve with no
  Bun process at all, if you don't need middleware, dynamic pages or API routes.

## Production

Run `optz build`, then `optz start` behind nginx. Serve `/assets/` from
`dist/static/assets/` directly (`gzip_static on`, immutable caching) and proxy everything else.
See `ops/nginx/optz.conf` and `ops/systemd/optz-web.service` in this repo for a complete setup.

## Tests

`bun test` in `framework/` covers route scanning, matching and the boot-script escaping.
