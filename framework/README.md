# optz

A small, fast React framework for Bun. File routes, nested layouts, streaming, Server Actions,
typed API routes, middleware, incremental static regeneration, i18n, image and font
optimization, and a response cache. Pages are **HTML by default**: only the components you mark
as islands ship JavaScript. Runs on Bun, as a single executable, or as an edge worker.

```sh
bun framework/src/cli.ts create apps/my-app   # a starter that shows the basics
cd apps/my-app && bun install
bun run dev      # http://127.0.0.1:3001, updates in place on save (Fast Refresh for islands)
bun run check    # generate route types + type-check everything
bun run build    # dist/   (--compile: also a single executable; --target edge: also a worker)
bun run start    # production server (PORT/HOST env vars override the config)
optz nginx       # nginx config generated from optz.config.ts
optz export      # static site only, for any static host
optz agents      # AGENTS.md, agent skills and MCP configs for Claude Code, Codex, Cursor, VS Code, Gemini
optz mcp         # MCP server (stdio) with this project's tools, for coding agents
```

`apps/features/` uses every feature below in one app; `node apps/features/e2e.cjs` checks them
in a browser. Compared with Next.js, feature by feature and measured:
[docs/OPTZ-VS-NEXTJS.md](../docs/OPTZ-VS-NEXTJS.md).

## Project layout

```
optz.config.ts          one typed config: client mode, features, cache, i18n, images, fonts, proxies
app/
  routes/               pages, one file per URL
  api/                  API routes, under /api
  components/           components; *.island.tsx ones hydrate in the browser
  lib/                  shared code ($lib/...)
  mcp/                  MCP tools, prompts and resources for AI clients, served at /mcp
  middleware.ts         runs before every page and API request
  sitemap.ts robots.ts manifest.ts   built into /sitemap.xml, /robots.txt, /manifest.webmanifest
  llms.ts               optional: replaces the generated /llms.txt
  styles.css            Tailwind CSS v4 (`@import "tailwindcss";`)
public/                 copied as-is
.optz/types.d.ts        generated: your routes and APIs as types
```

## Pages (`app/routes`)

| file | URL |
|---|---|
| `index.tsx` | `/` |
| `blog/[slug].tsx` | `/blog/:slug` |
| `docs/[...rest].tsx` | `/docs/*` (one or more segments) |
| `shop/[[...path]].tsx` | `/shop` and `/shop/*` (zero or more) |
| `(group)/pricing.tsx` | `/pricing` (brackets group files without a URL segment) |
| `_layout.tsx`, `_error.tsx`, `_loading.tsx`, `_404.tsx` | layout, error page, streaming fallback, not-found page |
| `about.og.tsx` | the Open Graph image of `about.tsx` |

```tsx
import { Link, notFound, redirect, type LoaderContext, type PageProps } from "optz";

export const config = { render: "static" } as const;   // "static" (default) | "client" | "dynamic"
export const paths = () => [{ slug: "hello" }];         // static pages with params: what to build
export const loader = ({ params }: LoaderContext<{ slug: string }>) => getPost(params.slug) ?? notFound();
export const head = (post: Post) => ({ title: post.title, description: post.summary, openGraph: { type: "article" } });

export default function Page({ data, params }: PageProps<Post, "/blog/[slug]">) {
  return <Link href="/blog">Back</Link>;   // href is checked against your routes
}
```

| render | when | per-request cost |
|---|---|---|
| `static` | content known at build time | a memory lookup |
| `client` | data comes from an API in the browser (feeds, dashboards) | a memory lookup |
| `dynamic` | needs the request (cookies, headers) or fresh server data | a React render, streamed (or cached with `cache`) |

`loader`, `paths` and `cache` run on the server only and never reach the browser.

### Streaming and async components

Dynamic pages stream: the layout and each `<Suspense>` fallback go out at once, and async
components fill in as they finish. `_loading.tsx` wraps the page in a boundary. Static pages wait
for every boundary at build time and contain no streaming scripts.

```tsx
export const config = { render: "dynamic" } as const;
async function Comments({ id }: { id: string }) {
  const comments = await db.comments(id);
  return <ul>{comments.map((c) => <li key={c.id}>{c.text}</li>)}</ul>;
}
export default function Post() {
  return <Suspense fallback={<p>Loading comments</p>}><Comments id="1" /></Suspense>;
}
```

React's streaming needs a few inline scripts. optz gives each streamed response a nonce and adds
it to the `Content-Security-Policy` your middleware set, so a strict CSP (no `'unsafe-inline'`)
keeps working.

### Incremental static regeneration

```tsx
export const revalidate = 60;          // rebuild in the background at most once a minute
export const tags = ["posts"];         // revalidateTag("posts") rebuilds it now
export const dynamicParams = true;     // render ids paths() didn't list on first request, then keep them
```

The stale copy is served while one background render replaces it. `revalidatePath("/blog")` and
`revalidateTag("posts")` (from `optz/server`) work from API routes and Server Actions, e.g. a CMS
webhook.

### Parallel and intercepting routes

A folder `@name` next to a `_layout.tsx` is a slot: the layout gets it as a prop, rendered from
the file in `@name` that matches the URL (or `@name/default.tsx`). A folder `(.)photo`,
`(..)photo` or `(...)photo` intercepts that URL during in-app navigation from its folder, e.g. a
photo that opens as a modal over the gallery but is a full page on reload:

```
gallery/_layout.tsx                 export default ({ children, modal }) => <>{children}{modal}</>
gallery/@modal/default.tsx          null
gallery/@modal/(.)photo/[id].tsx    the modal
gallery/photo/[id].tsx              the full page
```

## Islands: the payload optimization

In `client.mode: "islands"` (the default), a page is just HTML. A component in a file named
`*.island.tsx` renders on the server and **only it** hydrates in the browser. A page with no
islands ships no React at all.

```tsx
// app/components/Counter.island.tsx
export const hydrate = "visible";   // "load" (default) | "idle" | "visible"
export default function Counter({ start }: { start: number }) { ... }
```

- Props must be JSON. Islands inside islands render inline; the outer one owns them.
- `useParams()`, `useRouter()`, `useLocale()` and `<Link>` work inside islands.
- `client.navigation` swaps page HTML on link clicks (~2 KB) with prefetch on hover, inside a
  view transition where the browser has them.
- `client.speculation` (on): in browsers with speculation rules (Chromium), pages send a
  `Speculation-Rules` header and the browser prerenders a link while it's hovered, so the click
  is a real navigation that shows instantly, with a CSS cross-document view transition. Other
  browsers use the HTML swap. Apps with parallel or intercepting routes keep the swap, since a
  real navigation can't keep a slot or open an intercepted route in place.
- `useRouter().refresh()` (and any Server Action that revalidates) re-fetches the page and keeps
  every island whose props didn't change mounted, state and all.
- `client.runtime: "preact"` hydrates islands with Preact (~4 KB) instead of React (~60 KB).

| page | SPA + React | islands + React | islands + Preact |
|---|---:|---:|---:|
| home (2 islands) | 66.6 / 208 KB | 64.0 / 210 KB | **14.5 / 18 KB** |
| blog post (no islands) | 63.1 / 208 KB | 3.3 / 5.5 KB | **2.9 / 5.6 KB** |

(JS per page load, compressed / parsed.)

## Server Actions

Modules that start with `"use server"` export functions the browser can call. Islands import
them like any module; types come from the real code.

```ts
// app/actions/notes.ts
"use server";
import { ActionError, revalidatePath } from "optz/server";
export async function addNote(form: FormData): Promise<void> {
  const text = String(form.get("text") ?? "");
  if (!text) throw new ActionError("Write something first.");   // this message reaches the browser
  await db.notes.add(text);
  revalidatePath("/notes");                                       // the page updates in place
}
```

```tsx
<form action={addNote}>...</form>                       // works without JavaScript too
<form action={rename.bind(null, note.id)}>...</form>     // bound arguments, also without JS
const n = await countNotes();                           // from an island: a typed call
```

Calls from islands POST JSON (or the FormData) to `/_optz/action/<id>/<name>`; plain form posts
must come from the same site (CSRF check). Errors other than `ActionError` are reported as
"Something went wrong" in production.

## Server functions (`optz/server`)

`cookies()` (read, set, delete), `headers()`, `after(fn)` (run after the response is sent),
`draftMode()`, `revalidatePath()`, `revalidateTag()`, `locale()`. They work in API routes, Server
Actions and dynamic pages.

**Draft mode**: an API route your CMS calls turns it on with `draftMode().enable()`; while the
signed cookie is set, static pages render per request and `ctx.draft` is true in loaders.

## API routes (`app/api`), typed end to end

```ts
// app/api/posts/[id].ts  ->  /api/posts/:id
import { handler, json, type ApiContext, type HandlerContext, type RouteCache } from "optz";

export const cache: RouteCache = { maxAge: 30, staleWhileRevalidate: 300, tags: ["posts"] };
export const GET = ({ params }: ApiContext<{ id: string }>) => json({ id: params.id, likes: 3 });
export const POST = handler(async ({ params, body }: HandlerContext<{ id: string }, { text: string }>) =>
  json({ saved: (await body()).text }, { status: 201 }));
```

```ts
import { api } from "optz";
const post = await api("/api/posts/[id]", { params: { id: "7" } });   // post.likes: number
await api("/api/nope");   // type error: no such route
```

`export const prerender = true` runs GET at build time and serves the result from memory.

## Metadata, images, fonts, scripts

- **Head**: `title`, `description`, `canonical`, `robots`, `keywords`, `openGraph`, `twitter`,
  `alternates`; relative URLs become absolute with `site.url`.
- **Open Graph images**: `page.og.tsx` next to `page.tsx` returns JSX (inline styles, flexbox),
  rendered to a 1200×630 PNG at build time with satori and added to `og:image` automatically.
- **`<Image>`** (`optz/image`): `srcset` with widths from `images.sizes`, AVIF or WebP by the
  browser's `Accept`, width/height reserved, lazy below the fold, `priority` for the hero. Resized
  on first request with sharp, then kept in memory and on disk. Only local files and
  `images.remoteHosts` are served.
- **Fonts**: list Google Fonts css2 URLs in `fonts`; at build time they're downloaded into
  `/assets`, preloaded, and get a size-matched local fallback (`"Inter Fallback"`) computed from
  the font file, so text doesn't shift when they load. No request to Google at runtime.
  Downloads are cached in `~/.cache/optz` (`OPTZ_CACHE_DIR`), so rebuilds don't fetch them again
  and a build still works offline from a stale copy.
- **`<Script>`** (`optz/script`): `beforeInteractive`, `afterInteractive` (default) or
  `lazyOnload`; each src loads once, across navigations too.

## i18n

```ts
i18n: { locales: ["en", "fr"], defaultLocale: "en" }
```

`/fr/blog/x` renders `app/routes/blog/[slug].tsx` with `locale: "fr"` (in `PageProps`, loaders,
`head()`, `useLocale()`). The default locale has no prefix (`prefixDefault: true` adds one). `/`
redirects by `Accept-Language` or the `optz-locale` cookie. `<Link>` keeps the current locale,
`<Link locale="fr">` switches. Static pages are built once per locale, with `<html lang>` and
hreflang alternates.

## Middleware

```ts
// app/middleware.ts: one function or an array, run in order
export default defineMiddleware(async (ctx, next) => {
  ctx.locals.user = await userFrom(ctx.request);   // seen by loaders and API routes
  const res = await next();
  res.headers.set("X-Frame-Options", "DENY");
  return res;
});
```

## AI: MCP server, llms.txt and coding agents

**Your app as an MCP server.** Every file in `app/mcp` is a tool, prompt or resource that AI
clients (Claude, ChatGPT, Codex, Cursor, VS Code, Gemini CLI, ...) can use, served at `/mcp` with
the Model Context Protocol's Streamable HTTP transport. It's stateless JSON, so it runs the same
on Bun, the single executable and edge workers, behind any load balancer.

```ts
// app/mcp/search_posts.ts  ->  the tool "search_posts"
import { defineTool, ToolError } from "optz/mcp";

export default defineTool({
  description: "Search blog posts by title. Returns slugs, titles and URLs.",
  input: { type: "object", properties: { q: { type: "string", minLength: 2 }, limit: { type: "integer", default: 5 } }, required: ["q"] },
  annotations: { readOnlyHint: true },
  run: ({ q, limit }, { locals }) => {               // q: string, limit?: number, from the schema
    const hits = searchPosts(q).slice(0, limit);
    if (!hits.length) throw new ToolError(`Nothing matches "${q}"`);   // the model sees this
    return { posts: hits };                          // JSON text + structuredContent
  },
});
```

- Arguments are validated against `input` (types, `required`, `enum`, lengths, ranges, `pattern`)
  and defaults filled in before `run`; a bad call gets an error the model can correct.
- `definePrompt({ arguments, run })` and `defineResource({ uri: "posts://{slug}", list, read })`
  for prompts and resources (fixed URIs or templates).
- Requests go through `app/middleware.ts`, so authenticate there (`Authorization: Bearer ...`,
  put the user in `ctx.locals`); tools get `locals` and can call `cookies()`, `headers()`, `after()`.
- Browsers may only call it from `site.url` (or `mcp.allowedOrigins`): a check against DNS
  rebinding. Clients that aren't browsers send no `Origin`.
- `mcp: { pages: true }` (the default) adds the pre-rendered pages as resources, with
  `search_pages` and `read_page` tools: setting `mcp: {}` makes a docs site AI-readable with no
  code. A page counts only if a GET for it, with the caller's cookies and `Authorization`, gets
  through your middleware, so pages it protects stay protected. `mcp.instructions` tells the
  model what the server is for.
- `optz build` loads every `app/mcp` file and fails on a bad definition.

**llms.txt.** `optz build` writes `/llms.txt` (the site's pages by section, with descriptions,
[llmstxt.org](https://llmstxt.org)) and `/llms-full.txt` (every page as text). `llms: false`
turns them off; `llms.exclude` leaves paths out; `app/llms.ts` replaces the index.

**Coding agents.** `optz create` and `optz agents` write what coding agents read: `AGENTS.md`
(Codex, Cursor, Copilot, Gemini and others; `CLAUDE.md` imports it), two skills (`optz` for
building, `optz-mcp` for exposing an app to AI) in `.claude/skills` and `.agents/skills`, and MCP
configs (`.mcp.json`, `.codex/config.toml`, `.cursor/mcp.json`, `.vscode/mcp.json`,
`.gemini/settings.json`) that start `optz mcp`. That's a stdio MCP server with tools for the
project: `optz_project` (pages, render modes, APIs, actions, islands, config), `optz_match_url`,
`optz_docs` (this reference), `optz_scaffold` (new page/API/island/action/MCP tool, never
overwrites), `optz_check`, `optz_build` and `optz_fetch` (requests to the running dev server).
Re-running `optz agents` updates the optz parts and keeps everything else in those files.

## Deploy targets

| | command | what you get |
|---|---|---|
| Bun server | `optz build && optz start` | the fastest option; `optz nginx` for the proxy in front |
| Single executable | `optz build --compile` | `dist/server`: one file with the runtime, code, pages and assets (~105 MB) |
| Edge worker | `optz build --target edge` | `dist/edge/worker.js` + `wrangler.toml`: Cloudflare Workers, Deno Deploy, Vercel Edge |
| Static site | `optz export` | `dist/static` for any static host (no server features) |

The request handler is the same web-standard code everywhere; `apps/features/e2e.cjs` passes on
all three servers. Image optimization needs sharp: the executable uses it when it can find it,
edge workers serve originals. Open Graph images for static pages are prebuilt everywhere.

## Config

Every option is typed and documented on hover in `optz.config.ts`. The ones that change cost:

| option | default | effect |
|---|---|---|
| `client.mode` | `"islands"` | `"spa"` hydrates whole pages (more JS) |
| `client.runtime` | `"react"` | `"preact"`: ~60 KB less JS on pages with islands |
| `client.navigation` / `prefetch` | on | HTML-swap navigation / prefetch on hover |
| `client.speculation` | on | prerender on hover via speculation rules where supported |
| `features.dynamic` | on | off: per-request rendering is a build error and the renderer never loads (~13 MB less memory) |
| `features.streaming` | on | off: dynamic pages are sent whole |
| `features.actions`, `images`, `cache`, `middleware`, `api` | on | skip loading them entirely |
| `features.dynamicCompression`, `etag` | on | gzip and 304s for dynamic responses |
| `features.requestLog` | off | one log line per request |
| `cache.maxEntries` / `maxBytes` / `default` | 500 / 32 MB / none | response cache bounds, and a default for routes without `cache` |
| `server.idleTimeout` / `maxRequestBodySize` | 30 s / 1 MB | connection and body limits |
| `server.cdnMaxAge` | 0 | seconds a CDN may cache HTML pages (`s-maxage`, then `stale-while-revalidate`); browsers still revalidate |
| `proxy[prefix].cacheSeconds` | 0 | nginx micro-cache for a proxied API (via `optz nginx`) |
| `mcp` / `features.mcp` | on with `app/mcp` | the MCP endpoint (`path`, `instructions`, `pages`, `allowedOrigins`); loaded on its first request |
| `llms` | on | `/llms.txt` and `/llms-full.txt` at build time (`false`, `exclude`, `full`) |

## Dev server

`optz dev` rebuilds on save and updates open pages without reloading them: changed stylesheets
are swapped, changed islands are hot-swapped with React Fast Refresh (their state survives),
and the page's server-rendered HTML is replaced in place around them. In dev, islands always use
React (for Fast Refresh), whatever `client.runtime` says.

## Measured (one core)

Static pages ~55k req/s, prerendered API ~55k req/s, memory ~35 MB idle and ~50 MB under load.
Against Next.js 16 on the same app: ~100× the requests per second, a sixth of the memory, 2.9 vs
145 KB of JS on a blog post ([docs/OPTZ-VS-NEXTJS.md](../docs/OPTZ-VS-NEXTJS.md)). Against
nginx serving the same files: the same speed ([docs/NATIVE.md](../docs/NATIVE.md)).

## Tests

`bun test` in `framework/`: routing (optional catch-alls, slots, intercepts), the cache, islands,
actions, fonts, SEO files, MCP (schemas, the stdio server, `optz agents`), and the whole `apps/features` app in-process (streaming with nonces,
actions and CSRF, ISR, dynamicParams, intercepts, draft mode, i18n, MCP over HTTP, llms.txt). Browser checks:
`node apps/features/e2e.cjs` (22) and `node apps/features/hmr.cjs` (dev server, 6).
