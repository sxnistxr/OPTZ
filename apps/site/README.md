# The site

Personal site, blog and feed client, built on the optz framework (`../../framework`).

```sh
bun install            # once, from the repo root
bun run dev            # http://127.0.0.1:3001; needs the Rust API on :3000 for the feed
bun run build && bun run start
```

| change | where |
|---|---|
| name, intro, links | `content/site.json` |
| a blog post | `content/blog/<slug>.md` with `title`, `date` (YYYY-MM-DD) and `summary` front matter |
| pages | `app/routes/` |
| header, navigation | `app/routes/_layout.tsx` |
| shared components, API client, token store | `app/lib/` (imported as `$lib/...`) |
| security headers | `app/middleware.ts` |
| colours, fonts | the `@theme` block in `app/styles.css` |

Home, Writing and the blog posts are static (pre-rendered). The Feed pages are client-rendered
from the Rust API, so posting and liking never touch the Bun server.
