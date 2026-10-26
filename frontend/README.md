# Site

Personal site, blog and the client for the social feed, built with Tailwind CSS v4 into plain
static files. nginx serves them and proxies `/api/*` to the Rust API.

```sh
npm ci
npm run dev     # http://127.0.0.1:8080, rebuilds on save; set API_ORIGIN if the API isn't on :3000
npm run build   # writes dist/
```

| change | where |
|---|---|
| name, intro, links | `content/site.json` |
| a blog post | add `content/blog/<slug>.md` with `title`, `date` (YYYY-MM-DD) and `summary` front matter; the file name is the URL |
| page layouts | `build.mjs` (one template function per page) |
| colours and fonts | the `@theme` block in `src/styles.css` |
| feed, posting, likes, the live server readout | `src/social.js` |

Pushing to the tracked branch deploys it: the VPS pulls within 30 s, builds the API and the site,
and switches over only if the new release answers `/health`.

**Posting on the feed** needs a token, since the API has no login. On the server:
`sudo python3 /opt/optz/current/ops/mint-token.py <username>` prints one. Paste it on the Feed
page. It's kept only in that browser.
