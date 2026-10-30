# Getting started

## Requirements

- **Bun 1.4.4 or newer** (the framework package minimum; install from [bun.sh](https://bun.sh)).
- **Rust**, only for the engine in `portfolio/engine` (its `build.sh` uses a pinned toolchain).
- Linux or macOS. The engine needs Linux (io_uring).

## Run this site

```sh
git clone https://github.com/sxnistxr/OPTZ && cd OPTZ
bun install                         # one workspace: framework, site and apps
cd portfolio
bun run dev                         # http://127.0.0.1:3001, updates as you save
```

The commands every optz app has:

| command | what it does |
|---|---|
| `bun run dev` | dev server: rebuilds on save and updates open pages in place (islands keep their state) |
| `bun run check` | generates route types and type-checks the project |
| `bun run build` | production build into `dist/` (`--compile`: a single executable, `--target edge`: a worker) |
| `bun run start` | serves the build (`PORT` and `HOST` override the config) |
| `bunx optz nginx` | prints the nginx config for the app |
| `bunx optz export` | a static site in `dist/static`, for any static host |
| `bunx optz agents` | `AGENTS.md`, agent skills and MCP configs for Claude Code, Codex, Cursor, VS Code and Gemini CLI ([optz with AI](ai.md)) |
| `bunx optz mcp` | an MCP server (stdio) with the project's tools, for coding agents |

## Edit the site

| to change | edit |
|---|---|
| Name, intro, links | `portfolio/content/site.json` |
| Lab experiments | `portfolio/content/lab.json` |
| Blog posts | `portfolio/content/blog/*.md` (front matter: `title`, `date`, `summary`) |
| These docs | `portfolio/content/docs/` (new pages) and `portfolio/content/docs/index.json` (the menu) |
| Pages and layout | `portfolio/app/routes/` |
| Logo assets | `portfolio/public/dihlabs-*.svg`, `optz-*.svg`; generated source and prompt in `portfolio/branding/` |
| Light/dark theme behavior | `portfolio/public/site.js`, shared layout and `ThemeToggle.tsx` |
| Motion | `Trail.island.tsx`, `app/lib/trail-scene.ts` and `trail-geometry.ts` |
| Colors and fonts | `portfolio/app/styles.css`, `fonts` in `portfolio/optz.config.ts` |

Docs pages can also be any Markdown file in the repository: `index.json` points at
`framework/README.md`, `docs/NATIVE.md` and others, and links between them are rewritten to
`/docs/...` (or to GitHub, for files that aren't docs pages).

## Make a new app

```sh
bun framework/src/cli.ts create apps/my-app
cd apps/my-app && bun install && bun run dev
```

The starter has a static page, a page with params, a dynamic page with caching, an island, an
API route with a typed client, middleware and `$lib` imports. `apps/features` shows the rest.

## Add accounts and persistent data

Use the full-stack template for SQLite, password accounts, revocable sessions, private notes,
attachments and server-sent events:

```sh
# From the repository root
bun framework/src/cli.ts create apps/my-app --template fullstack
cd apps/my-app
bun install
cp .env.example .env
bun run dev
```

The [full-stack guide](full-stack.md) explains the data layer and deployment boundaries.
[Application APIs](application-apis.md) documents the optional exports. The SQLite starter
targets Bun with persistent disk; it does not run unchanged on an edge worker.

## A first page

```tsx
// app/routes/hello/[name].tsx  ->  /hello/ada
import type { LoaderContext, PageProps } from "optz";

export const paths = () => [{ name: "ada" }, { name: "grace" }];   // built at build time
export const loader = ({ params }: LoaderContext<{ name: string }>) => ({ name: params.name });

export default function Hello({ data }: PageProps<{ name: string }, "/hello/[name]">) {
  return <h1>Hello, {data.name}</h1>;
}
```

```tsx
// app/components/Counter.island.tsx: the only part of the page that ships JavaScript
import { useState } from "react";
export const hydrate = "visible";
export default function Counter() {
  const [n, setN] = useState(0);
  return <button onClick={() => setN(n + 1)}>Clicked {n} times</button>;
}
```

From here, the [framework reference](/docs/framework) covers layouts, API routes, Server
Actions, streaming, caching and the rest.
