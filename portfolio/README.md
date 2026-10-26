# dihlabs.lol

The site of dihlabs.lol, a dev lab by sxnistxr: the lab's experiments, writing, and the
documentation for this whole repository. Built on the optz framework (`../framework`). The
folder also holds the Rust engine (`engine/`), the $12 Server Challenge entry, which runs next to
the site in production; its old social frontend is now `apps/social`.

```
portfolio/
  optz.config.ts            how it's served: islands + Preact, feature switches, cache, fonts
  app/
    routes/                 /, /lab, /blog, /blog/[slug], /docs, /docs/[slug]
      docs/_layout.tsx      the docs sidebar (search + every page by section)
      *.og.tsx              Open Graph cards, rendered to PNG at build time
    api/                    /api/status (live timing), /api/blog and /api/docs (prerendered)
    components/             Pulse.island (live server timing), DocsSearch.island, Lab, PostList
    lib/                    docs.ts (Markdown docs), posts.ts (blog), lab.ts, site.ts, og-card.tsx
    sitemap.ts robots.ts    built into /sitemap.xml and /robots.txt
    middleware.ts           security headers (strict CSP, no 'unsafe-inline', fonts from 'self')
    styles.css              Tailwind v4 theme, blog and docs typography
  content/
    site.json               name, intro, links, URL, repository
    lab.json                the lab's experiments
    blog/*.md               posts
    docs/                   the docs menu (index.json) and pages written for the site
  e2e.cjs                   browser checks for the site
  engine/                   the Rust + io_uring + SQLite server (submissions/rust-iouring-sxnistxr links here)
```

## Run it

```sh
bun install                         # once, from the repo root
bun run dev                         # http://127.0.0.1:3001
bun run check                       # type-check everything (routes, links, API calls)
bun run build && bun run start      # production
node e2e.cjs http://127.0.0.1:3001  # browser checks against a running build
```

## Edit

| change | where |
|---|---|
| name, intro, links | `content/site.json` |
| an experiment | `content/lab.json` (`status`: `exploring`, `shipped` or `paused`) |
| a blog post | `content/blog/<slug>.md` with `title`, `date`, `summary` front matter |
| a docs page | a Markdown file anywhere in the repo, listed in `content/docs/index.json` |
| a page | `app/routes/` (links to it become type-checked automatically) |
| what's on or off, caching, limits | `optz.config.ts` |

Docs pages are rendered at build time: headings get anchors, links between docs become
`/docs/<slug>`, links to other repository files go to GitHub, and `/api/docs` (the search index)
is prerendered with them.

## What a visitor downloads

| page | JavaScript (compressed) |
|---|---:|
| a blog post, the lab | 2.9 KB (navigation only) |
| home | navigation + Preact + the live-timing island |
| docs | navigation + Preact + the search island (hydrates when the browser is idle) |
