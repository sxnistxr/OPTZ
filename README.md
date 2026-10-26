# OPTZ

| folder | what |
|---|---|
| `portfolio/` | **The site**: pages, typed API routes, components, content and the Rust feed engine, in one folder |
| `framework/` | **optz**, the React framework for Bun it's built on (islands, typed routes/APIs, caching, middleware) |
| `apps/example/` | The `optz create` starter |
| `apps/features/` | Every Next.js-parity feature in one app, with browser checks |
| `submissions/rust-iouring-sxnistxr` | Link to `portfolio/engine` (the $12 Server Challenge entry) |
| `ops/` | Production: systemd units, generated nginx, deploys with rollback, verified backups |
| `deploy/` | The VPS auto-sync (pulls this branch every 30 s and deploys) |
| `bench/` | The portfolio ported to Next.js (`compare.sh`), and optz vs nginx in C (`native.sh`) |
| `docs/` | Design notes and measurements ([optz vs Next.js](docs/OPTZ-VS-NEXTJS.md), [would C be faster?](docs/NATIVE.md)) |

```sh
bun install
cd portfolio && bun run dev        # site with live reload (needs the engine on :3000 for the feed)
cd framework && bun test           # framework tests
```
