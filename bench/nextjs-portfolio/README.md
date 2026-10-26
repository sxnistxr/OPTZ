# The portfolio on Next.js

`portfolio/` ported to Next.js 16 for [docs/OPTZ-VS-NEXTJS.md](../../docs/OPTZ-VS-NEXTJS.md).
Same pages, components, styles, headers and API; `content/` and `public/` are copied from
`portfolio/` at build time (`npm run sync`).

```sh
npm ci && npm run build && npm start   # http://127.0.0.1:3011
bash ../compare.sh                     # benchmark against optz
```
