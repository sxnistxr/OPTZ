# Getting started

Create an OPTZ app and run it on your machine.

## Requirements

- [Bun](https://bun.sh) 1.4.4 or newer.
- Linux or macOS.

## Create an app

```sh
bunx @sxnistxr/optz create my-app
cd my-app
bun add optz@npm:@sxnistxr/optz
bun run dev
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001). Pages update in place as you save.

> [!NOTE]
> `create` links the new app to the copy of OPTZ that ran the command. `bun add` replaces that
> link with the published package, so the app keeps working on another machine or after Bun
> clears its cache.

## Pick a starting point

| start from | how |
|---|---|
| The starter | `bunx @sxnistxr/optz create my-app`: a static page, a page with params, a dynamic page with caching, an island, a typed API route and middleware |
| Accounts and a database | Add `--template fullstack`, then `cp .env.example .env`. See [Build a full-stack app](full-stack.md) |
| Every feature in one app | Clone the repository and run `apps/features`. See [Every feature in one app](../../../apps/features/README.md) |
| Sign-in, passkeys and MFA | Clone the repository and run `apps/auth`. See [Authentication](../../../packages/auth/README.md) |
| An existing Bun project | `bun add optz@npm:@sxnistxr/optz react react-dom`, then follow the [project layout](../../../framework/README.md#project-layout) |

## Project structure

```files
title: Where things go
app/routes/ -> one file per page, named for its URL
app/api/ -> API routes, under /api
app/components/ -> components; *.island.tsx ones hydrate in the browser
app/lib/ -> shared code, imported as $lib/...
app/middleware.ts -> runs before every page and API request
optz.config.ts -> rendering, features, caching, i18n, images, fonts
public/ -> copied to the site as-is
```

## Commands

| command | what it does |
|---|---|
| `bun run dev` | Dev server: rebuilds on save and updates open pages in place (islands keep their state) |
| `bun run check` | Generates route types and type-checks the project |
| `bun run build` | Production build into `dist/` (`--compile`: a single executable, `--target edge`: a worker) |
| `bun run start` | Serves the build (`PORT` and `HOST` override the config) |
| `bunx optz nginx` | Prints the nginx config for the app |
| `bunx optz export` | A static site in `dist/static`, for any static host |
| `bunx optz agents` | `AGENTS.md`, agent skills and MCP configs for Claude Code, Codex, Cursor, VS Code and Gemini CLI ([OPTZ with AI](ai.md)) |
| `bunx optz mcp` | An MCP server (stdio) with the project's tools, for coding agents |

## Next steps

- [Learn OPTZ](learn/create.md): build a small app one concept at a time, from first page to deploy.
- [Framework reference](../../../framework/README.md): every option in one place.
- [Contributing](contributing.md): run this site and work on OPTZ itself.
