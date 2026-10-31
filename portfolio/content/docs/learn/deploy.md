# Build and deploy

Check the project, make a production build, run it, and choose where it lives.

## Check and build

```sh
bun run check
bun run build
```

```text
optz: types ok
optz: built 8 pages, 2 API routes, 3 islands, 1 actions, MCP 1 tool (islands, react), pre-rendered 10 in 441 ms
```

The build renders every static page, writes compressed copies next to each file, and bundles
each island on its own. Everything lands in `dist/`.

## Run it

```sh
bun run start
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001). This is the production server: static pages
come from memory, `/suggest` renders per request, and the API answers under `/api`. Set `PORT` and
`HOST` to override the config.

## Choose where it runs

| target | command | good for |
|---|---|---|
| A Bun server | `bun run start` | Everything this app does, behind nginx or a platform proxy |
| One executable | `bun run build --compile` | Copying a single file to a server |
| An edge worker | `bun run build --target edge` | Running close to visitors |
| Static files | `bunx optz export` | Any static host, for pages that need no server |
| nginx in front | `bunx optz nginx` | Printing an nginx config generated from your app |

Your reading list needs a server for `/suggest` and its Server Action, so a static export would
leave those out. Use a Bun server, an executable or a worker for it.

> [!TIP]
> The [deployment guide](../deployment.md) walks through how this site runs in production:
> systemd units, a generated nginx config, deploys with rollback, and verified backups.

## What you built

```flow
title: The reading list, chapter by chapter
Pages | `/books` | A static page with a typed link
Data | `/books/[slug]` | A page per book, built from `paths`
Islands | `Rating` | The only JavaScript on a book page
Forms* | `/suggest` | A Server Action that works without JavaScript
API | `/api/books/random` | JSON with a typed client
```

## Keep going

- [Framework reference](../../../../framework/README.md): every routing, rendering, data and
  configuration option.
- [Build a full-stack app](../full-stack.md): accounts, SQLite sessions, private notes and live
  updates.
- [Optional modules](../../../../docs/MODULES.md): uploads, analytics, status pages, environment
  variables and more.
- [OPTZ with AI](../ai.md): give coding agents your project's tools, and turn your app into an
  MCP server.
