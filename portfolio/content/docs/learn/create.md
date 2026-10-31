# Create your app

Make a new OPTZ app, start the dev server, and find your way around the files it gives you.

Over the next seven chapters you'll build a small reading list: a page of books, a page for each
book, a star rating, a form for suggestions and an API that picks a book at random. Each chapter
adds one working feature and explains the idea behind it. You need
[Bun](https://bun.sh) 1.4.4 or newer.

## Create the project

```sh
bunx @sxnistxr/optz create my-app
cd my-app
bun install
```

`create` writes a starter app into `my-app` with a versioned dependency on the published OPTZ
package. `bun install` installs its dependencies.

## Start the dev server

```sh
bun run dev
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001). You'll see "Hello, world." and a button that
counts clicks.

Now open `app/lib/greeting.ts`, change `Hello` to `Welcome`, and save. The page updates in place,
without a reload. Change it back when you're done.

## Look around

Every file in `app/routes` is a page, and its path is its URL. API routes live in `app/api`.

```files
title: What the starter's files become
app/routes/index.tsx -> /
app/routes/about.tsx -> /about
app/routes/users/[name].tsx -> /users/ada and /users/grace
app/routes/time.tsx -> /time, rendered for every request
app/api/hello.ts -> /api/hello
app/components/Counter.island.tsx -> the only JavaScript on /
```

| file | what it's for |
|---|---|
| `optz.config.ts` | One typed config: rendering, client navigation, features, caching |
| `app/routes/_layout.tsx` | The layout around every page: the nav and `<main>` |
| `app/middleware.ts` | Runs before every page and API request |
| `app/lib/` | Shared code, imported as `$lib/...` |
| `app/components/` | Components, imported as `$components/...` |
| `AGENTS.md`, `.mcp.json` | Instructions and tools for coding agents ([OPTZ with AI](../ai.md)) |

## Commands you'll use

| command | what it does |
|---|---|
| `bun run dev` | Dev server: rebuilds on save and updates open pages in place |
| `bun run check` | Generates route types and type-checks the project |
| `bun run build` | Production build into `dist/` |
| `bun run start` | Serves the production build |

Keep the dev server running. In the next chapter you'll add your first page.
