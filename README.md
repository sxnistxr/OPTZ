# OPTZ

| folder | what |
|---|---|
| `submissions/rust-iouring-sxnistxr/` | The $12 Server Challenge entry: the feed API in Rust on raw io_uring and SQLite |
| `framework/` | **optz**, a small React framework for Bun (routes, layouts, loaders, middleware, `$lib`) |
| `apps/site/` | The personal site, blog and feed client, built on optz |
| `apps/example/` | The `optz create` starter, showing every framework feature once |
| `ops/` | Production: systemd units, nginx, deploys with rollback, verified backups |
| `deploy/` | The VPS auto-sync (pulls this branch every 30 s and deploys) |
| `docs/` | Design notes and measurements |

```sh
bun install                       # JavaScript workspace (framework + apps)
cd apps/site && bun run dev       # site with live reload
cd framework && bun test          # framework tests
```
