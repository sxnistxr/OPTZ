# features

Every feature optz shares with Next.js, in one small app: streaming and `_loading`, Server
Actions (also without JavaScript), ISR and on-demand revalidation, `dynamicParams`, draft mode,
optional catch-alls, parallel and intercepting routes, i18n (en/fr), Open Graph images, sitemap,
robots and manifest, `<Image>`, self-hosted fonts, `<Script>`, prerendered and cookie-setting API
routes, and an error page, all under a strict CSP.

```sh
bun run build && bun run start        # http://127.0.0.1:3002
node e2e.cjs http://127.0.0.1:3002    # 22 browser checks
bun run dev  &  node hmr.cjs          # dev server: Fast Refresh, CSS swap, in-place updates (6 checks)
```

The same suite passes against `optz build --compile` (`dist/server`) and
`optz build --target edge` (`dist/edge/worker.js` in Cloudflare's workerd), with `UNOPTIMIZED=1`
where no image library is available.
