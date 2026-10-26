# portfolio

The whole site in one folder: pages, typed API routes, components, content, and the Rust engine
that runs the social feed. Built on the optz framework (`../framework`).

```
portfolio/
  optz.config.ts            how it's served: islands + Preact, feature switches, cache, limits,
                            and the engine proxy (with an nginx micro-cache)
  app/
    routes/                 pages: /, /blog, /blog/[slug], /social, /social/post/[id]
    api/                    typed API routes: /api/blog, /api/status
    components/             UI; *.island.tsx files hydrate in the browser, everything else is HTML only
      Pulse.island.tsx      live server timing (hydrates on load)
      Feed.island.tsx       newest posts (hydrates when scrolled into view)
      Social.island.tsx     token, compose box and feed (one island: they share state)
      PostView.island.tsx   one post, by the id in the URL
    lib/                    social.ts (typed engine client), auth.ts (token store), posts.ts (blog),
                            format.ts, site.ts
    middleware.ts           security headers (strict CSP, no 'unsafe-inline')
    styles.css              Tailwind v4 theme
  content/                  site.json (name, intro, links) and blog/*.md
  public/                   favicon
  engine/                   the Rust + io_uring + SQLite feed API (also the $12 Server Challenge
                            entry; submissions/rust-iouring-sxnistxr links here)
```

## Run it

```sh
bun install                         # once, from the repo root
bun run engine:build                # builds engine/ (pinned Rust toolchain: engine/install.sh)
SQLITE_PATH=… JWT_SECRET=… HOST=127.0.0.1 PORT=3000 bash engine/start.sh &
bun run dev                         # http://127.0.0.1:3001
bun run check                       # type-check everything (routes, links, API calls)
bun run build && bun run start      # production
bun run nginx                       # the nginx config for production
```

## How requests flow in production

```
browser ── nginx :80 ─┬─ /api/social/*  → engine (Rust, :3000)    1 s micro-cache on GETs
                      ├─ /assets/*      → dist/ on disk           immutable, pre-compressed
                      └─ everything else → optz on Bun (:3001)    pages from memory, /api/* typed routes
```

## Edit

| change | where |
|---|---|
| name, intro, links | `content/site.json` |
| a blog post | `content/blog/<slug>.md` with `title`, `date`, `summary` front matter |
| a page | `app/routes/` (links to it become type-checked automatically) |
| an API route | `app/api/` (call it from the browser with `api("/api/…")`, fully typed) |
| something interactive | a `*.island.tsx` in `app/components/` |
| what's on or off, caching, limits | `optz.config.ts` |

## What a visitor downloads

| page | JavaScript (compressed) |
|---|---:|
| a blog post | 2.9 KB (navigation only) |
| home, feed | ~14.5 KB (navigation, Preact, islands) |

Before islands it was ~63–67 KB on every page.
