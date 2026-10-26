# Contributing

How to work on optz itself, the site and the engine: where things live, how to check a change,
and how a commit reaches production.

## Setup

```sh
git clone https://github.com/sxnistxr/OPTZ && cd OPTZ
bun install            # the workspace: framework/, portfolio/, apps/*
```

One `node_modules` at the root (`bunfig.toml` sets the hoisted linker), so every app resolves the
framework's dependencies and the framework itself (`optz` is `framework/src/index.ts`, no build
step: Bun runs the TypeScript directly).

## Checks before a commit

| check | command | covers |
|---|---|---|
| Framework tests | `cd framework && bun test` | routing, the cache, islands, actions, fonts, SEO files, and `apps/features` end to end in-process |
| Framework types | `bun node_modules/typescript/bin/tsc --noEmit -p framework/tsconfig.json` | the framework's own types |
| App types | `bun run check` in each app | generated route types + the app's code |
| Feature browser checks | `node apps/features/e2e.cjs http://127.0.0.1:3002` | 22 checks in Chromium against a running build |
| Dev server checks | `node apps/features/hmr.cjs` | Fast Refresh, CSS swap, in-place updates (needs `bun run dev`) |
| Site browser checks | `node portfolio/e2e.cjs http://127.0.0.1:3001` | this site: navigation, docs, search, lab, strict CSP |
| Social demo | `node apps/social/e2e.cjs` | the feed over the engine (needs the engine running) |
| Engine | `cd portfolio/engine && cargo test --release` | unit tests; `tests/*.py` for protocol, crash and memory checks |

Browser checks use Playwright with the preinstalled Chromium (`NODE_PATH=$(npm root -g)`).
`e2e.cjs` also runs against the single executable and the edge worker (`UNOPTIMIZED=1` where
there's no image library).

## Benchmarks

| script | measures |
|---|---|
| `bash bench/compare.sh` | optz vs the Next.js port: req/s, p99, memory, cold start, build time |
| `bash bench/native.sh` | optz vs the single executable vs nginx (C) on the same files |

Both pin the server to one core with `taskset` and run `wrk` on the others. Numbers vary by about
5–10% between runs on a shared machine; compare within one run.

## Conventions

- **Web-standard code in the request path.** `handler.ts` and what it imports must run on Bun,
  in `workerd` and in Node: no `Bun.*` and no `node:fs` there. Bun-specific code goes in
  `server.ts` (the platform object) or build-time modules.
- **Nothing per request that can happen at build time.** New features check: does a static page
  pay for this? (Static requests skip the request context, middleware-free paths and header
  lookups on purpose.)
- **Off when unused.** Heavy features load lazily (`import()`), and get a `features.*` switch
  when they cost memory or time.
- **Strict CSP stays possible.** No inline scripts or styles in framework output; streaming uses
  nonces.
- **Types are the API.** Public options live in `types.ts` with doc comments (they show on
  hover); generated types in `codegen.ts` keep routes and APIs checked.
- **Comments say why**, at the top of each module and where code isn't obvious.

## Adding a framework feature

1. Types and config in `types.ts` (documented), defaults in `resolveConfig`.
2. Build-time work in `build.ts`, request-time work in `handler.ts` (portable).
3. A page or API in `apps/features` that uses it, and a check in `framework/test/features.test.ts`
   and/or `apps/features/e2e.cjs`.
4. The reference in `framework/README.md` (it's the [framework reference](/docs/framework) page).
5. Run the checks above and `bench/compare.sh` to make sure static pages didn't get slower.

## From commit to production

```
git push  ──>  VPS polls GitHub every 30 s (deploy/sync.sh, systemd timer)
               └─ deploy/post-deploy.sh ─> ops/deploy.sh
                    1. build the engine (Rust, as the unprivileged optz user, cached)
                    2. bun install --frozen-lockfile, optz check, optz build (the site)
                    3. generate nginx config from optz.config.ts
                    4. switch /opt/optz/current to the new release, restart services
                    5. health-check the engine and the site for 30 s, else roll back
```

A commit that fails type-checking or building never goes live; one that starts but isn't
healthy is rolled back to the previous release. See [Deployment](/docs/deployment).
