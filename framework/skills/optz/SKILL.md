---
name: optz
description: Build and change apps on optz, the small React framework for Bun (file routes in app/routes, islands, Server Actions, typed API routes, ISR, middleware). Use when a project has optz.config.ts or imports from "optz", or the user asks to add a page, API route, island, action or MCP tool to an optz app.
---

# Working on an optz app

optz looks like Next.js but isn't: no `app/page.tsx`, no `"use client"`, no `next/*` imports.
Pages are **HTML by default**; only `*.island.tsx` components ship JavaScript. Check with the
project's own files before assuming an API exists.

## First look

If the `optz` MCP server is connected, call `optz_project` (routes, render modes, APIs, actions,
islands, MCP tools, config) and `optz_docs` (the framework reference) instead of grepping.
Otherwise read `optz.config.ts`, list `app/`, and read `node_modules/optz/README.md`.

## Where things go

| what | file | notes |
|---|---|---|
| page | `app/routes/blog/[slug].tsx` | default export component; `loader`, `head`, `paths`, `config` |
| layout / error / loading / 404 | `_layout.tsx`, `_error.tsx`, `_loading.tsx`, `_404.tsx` | per folder |
| API route | `app/api/posts/[id].ts` → `/api/posts/:id` | export `GET`, `POST`, ...; return `json(...)` |
| interactive component | `app/components/Thing.island.tsx` | the only code that hydrates; props must be JSON |
| Server Action | any `app/**/*.ts` starting with `"use server"` | callable from islands and `<form action>` |
| middleware | `app/middleware.ts` | `defineMiddleware(async (ctx, next) => ...)` |
| MCP tool for AI clients | `app/mcp/<name>.ts` | `export default defineTool(...)` from `optz/mcp` (see the optz-mcp skill) |
| sitemap / robots / llms.txt | `app/sitemap.ts`, `app/robots.ts`, `app/llms.ts` | built at build time |

`.ts` files inside `app/routes` are helpers, not routes. Folders/files starting with `_` aren't routes.

## Render modes (pick the cheapest that works)

- `static` (default): rendered at build time. Params need `export const paths = () => [...]`
  (or `export const dynamicParams = true`). Add `export const revalidate = 60` for ISR.
- `client`: one shell for every URL; islands fetch their own data. Use for dashboards/feeds.
- `dynamic`: `export const config = { render: "dynamic" } as const;` rendered per request, streamed.
  Only when it needs the request (cookies, headers) or always-fresh server data. `features.dynamic`
  may be off in the config: then dynamic pages are a build error.

## Idioms

```tsx
import { Link, notFound, type LoaderContext, type PageProps } from "optz";
export const paths = () => posts.map((p) => ({ slug: p.slug }));
export const loader = ({ params }: LoaderContext<{ slug: string }>) => getPost(params.slug) ?? notFound();
export const head = (post: Post) => ({ title: post.title, description: post.summary });
export default function Post({ data }: PageProps<Post, "/blog/[slug]">) { return <Link href="/blog">Back</Link>; }
```

```ts
// app/api/notes.ts
import { handler, json, type HandlerContext } from "optz";
export const GET = () => json({ notes });
export const POST = handler(async ({ body }: HandlerContext<{}, { text: string }>) => json({ saved: (await body()).text }, { status: 201 }));
// in an island: const { notes } = await api("/api/notes");   (typed from the route file)
```

```ts
// app/actions/notes.ts
"use server";
import { ActionError, revalidatePath } from "optz/server";
export async function addNote(form: FormData) {
  if (!form.get("text")) throw new ActionError("Write something first.");
  revalidatePath("/notes");
}
```

- Server-only helpers: `cookies()`, `headers()`, `after()`, `draftMode()`, `revalidatePath()`,
  `revalidateTag()`, `locale()` from `optz/server` (API routes, actions, dynamic pages, MCP tools).
- `<Link href>` is type-checked against the routes; `api("/api/...")` against API routes.
- Images: `import { Image } from "optz/image"` (needs `alt`). Scripts: `optz/script`.
- Styling is Tailwind v4 in `app/styles.css`.
- Keep islands small and leaf-level; pass plain JSON props; never import server-only code into them.

## Done means

1. `bun run check` (or `optz check`): generates route types and type-checks. Fix every error.
2. `bun run build` succeeds (static pages render at build time, so loader bugs show up here).
3. For behavior: `bun run dev` and request the URL (or `optz_fetch` with the MCP server), or add
   a test next to the existing ones.

Don't hand-edit `.optz/` or `dist/`; they're generated.
