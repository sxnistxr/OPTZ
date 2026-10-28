# OPTZ

The code behind [dihlabs.lol](https://dihlabs.lol), a dev lab by sxnistxr. Full documentation: [dihlabs.lol/docs](https://dihlabs.lol/docs) (sources in `portfolio/content/docs` and the READMEs below).

| folder | what |
|---|---|
| `portfolio/` | **The site** (dihlabs.lol): lab, writing and docs pages, typed API routes, content, and the Rust engine |
| `framework/` | **optz**, the React framework for Bun it's built on (islands, typed routes/APIs, caching, middleware) |
| `apps/fullstack/` | Complete Bun + SQLite app: password accounts, private notes/uploads and persistent sessions |
| `apps/example/` | The `optz create` starter |
| `apps/features/` | Every Next.js-parity feature in one app, with browser checks |
| `apps/social/` | The social network demo over the Rust engine (it used to be on the site) |
| `submissions/rust-iouring-sxnistxr` | Link to `portfolio/engine` (the $12 Server Challenge entry) |
| `ops/` | Production: systemd units, generated nginx, deploys with rollback, verified backups |
| `deploy/` | CI-gated automatic deployment migration; reviewed release workflow |
| `bench/` | The portfolio ported to Next.js (`compare.sh`), and optz vs nginx in C (`native.sh`) |
| `docs/` | Design notes and measurements ([optz vs Next.js](docs/OPTZ-VS-NEXTJS.md), [would C be faster?](docs/NATIVE.md)) |

```sh
bun install
cd portfolio && bun run dev        # the site, updating in place as you save
cd framework && bun test           # framework tests
```

Full applications: `optz create apps/my-app --template fullstack`. See [full-stack research and roadmap](docs/FULLSTACK-RESEARCH.md) for the framework comparison, new optional modules and measured routing improvements.
