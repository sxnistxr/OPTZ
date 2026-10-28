# Full-stack OPTZ: research, implementation and remaining decisions

Research date: 2026-10-28. Baseline: `f5a5bb0` (the merged security/deployment work).
The design target is the existing Bun + React/Preact islands framework on a small VPS, with
SQLite and revocable server-side sessions, as requested. The comparisons below describe
capabilities, not interchangeable APIs or a claim of complete compatibility.

## What the other frameworks actually contribute

| Framework | Useful model to adopt | How OPTZ applies it |
|---|---|---|
| Next.js | Server-side data access layer, authorize each data operation, Server Actions, server-only boundaries, request instrumentation | Keep existing actions/rendering; add guarded `.server.ts` modules, optional observation and a starter that authorizes in SQL/data access |
| SvelteKit | Native form actions, `fail()` field errors, progressive enhancement, cookie/local request context, adapters | Standard Schema/function validation with safe 422 field errors; HTML forms in the starter work without JS; storage contracts stay separate from rendering |
| Astro | Sessions with pluggable drivers, validated Actions, islands, schema-validated content collections, isolated server islands | Add revocable session stores and validation; retain client islands; defer a new content compiler and isolated server-island protocol until workloads justify them |
| React Router (Remix model) | Route-oriented loaders/actions, cookie/session storage contracts, upload handling | Reuse current loaders/API/actions; provide a small session store contract and bounded private upload storage |
| Nuxt/Nitro | Server utilities, middleware, route caching, deployment adapters, lazy hydration and performance budgets | Keep SSR/ISR/proxy/edge features; add optional security/observation utilities while preserving the static path |
| Hono | Small opt-in CSRF, CORS, secure-header and SSE helpers | Offer explicit `optz/security` and `optz/stream` modules without adding a middleware stack to every request |
| TanStack Start | Typed server functions, middleware and an authentication integration boundary | Preserve generated API types/actions; avoid hard-wiring a hosted auth provider or ORM into core |

Authentication libraries, email delivery, payment services, authorization policies and durable
job infrastructure are product choices. Next.js, SvelteKit and TanStack document integrations;
they do not bundle a universal production identity service, ORM and background-job service.
This release provides a working local app and replaceable primitives, while keeping those
external choices explicit.

## Gap analysis and what ships

| Area | Before this change | This implementation | Cost when unused |
|---|---|---|---|
| Pages, nested/parallel/intercepted routes, streaming, ISR, i18n | Already present | Preserved and regression-tested | Existing configurable behavior |
| Client islands, Preact, prefetch and accessible navigation | Already present | Preserved | Pages without islands do not ship React |
| Typed APIs and Server Actions | Already present | Preserved | Features can be disabled |
| Sessions | Cookie primitives and social-demo bearer tokens | `optz/sessions`: opaque 256-bit tokens, hash-only server keys, rotation/revocation/expiry, custom store contract | No session lookup or store in core |
| Persistent app data | Project-specific Rust feed engine | `optz/sqlite`: Bun native DB, WAL/foreign keys, transactional checksum-protected migrations, persistent session adapter | Bun SQLite is imported only by applications using it |
| Input validation | Typed JSON parsing, application checks | `optz/forms`: Standard Schema V1 or a function validator; bounded JSON/form parsing, safe structured field errors | No bundled schema dependency |
| Browser/server separation | Loader export stripping | Browser build rejects transitive `.server.*`, `app/lib/server/` and private OPTZ imports | Build-time only |
| Request security | Application-authored middleware | Opt-in CSRF, allowlisted CORS, safe headers, bounded local rate limiter | No global auth/security middleware added |
| Attachments | Static assets and image optimizer | `optz/storage`: streaming writes, quotas supplied by caller, random keys, private attachment reads, no path traversal or symlink reads | No storage code or file I/O in the core request path |
| Live updates | Generic Response streams | `optz/stream`: pull-based SSE, event-size budget, framing validation, cancellation and cleanup | No connection pool or timer unless an app opens one |
| Observation | Request log option | `optz/observe`: request ID, Server-Timing, response/error callbacks excluding queries/credentials/bodies | Opt-in middleware |
| Complete starter | Rendering/API examples | `optz create DIR --template fullstack`: accounts, private notes, private attachments, SSE endpoint, native forms and environment/state guide | Separate template/app |
| Large route tables | Linear server route scans | Exact-route map plus ordered dynamic prefix candidates | O(routes) startup index; tiny per-request lookup |

## Full application shipped

`apps/fullstack/` is executable application code, not pseudocode. It demonstrates:

1. A static public landing page, dynamic login/error page, and protected dashboard.
2. Argon2id password hashes through Bun's native async password API, with a bounded hash-work budget.
3. Session identity rotation at login, persistent hashed tokens in SQLite and logout revocation.
4. Authentication at the data access boundary and owner predicates on every note/file query.
5. Create, list, toggle and delete private notes through native HTML forms.
6. Bounded multipart parsing, upload concurrency and per-user file quotas; private attachment downloads.
7. Cookie-authenticated mutation origin checks and strict response security headers.
8. Bounded authenticated SSE connections; streams observe disconnects and session revocation.
9. API-level integration tests for two identities, cross-user denial, CSRF and process restart persistence.
10. A browser suite that performs registration, notes, upload and logout with JavaScript disabled.

The example rate limiter and SSE connection budget are per process. Multi-replica deployments
must use an external/shared limiter and session store. The cookie/session manager itself is
portable; the provided SQLite store is a Bun/single-machine option. Password recovery, verified
email, OAuth, MFA, invites and account administration are not silently approximated by the demo.
Use a maintained identity provider when the product needs them.

## Performance changes and evidence

- Compile the immutable server manifest once. Exact static paths no longer scan unrelated routes.
  Dynamic candidates are filtered by their leading static segment and merged in original order,
  preserving catch-all, optional and custom manifest precedence. Fully generic dynamic patterns
  can still require a linear candidate scan.
- Skip middleware identity planning when no middleware is registered. Authentication remains
  checked in the data layer; the security middleware pipeline is preserved when installed.
- Optional app modules are separate package exports, never imported by the default client API.
  No ORM, auth SDK, validator or middleware framework was added to runtime dependencies.
- Repeated form fields append to an array instead of repeatedly copying its full contents.
- Notes use one conditional SQL insert for quota enforcement; file metadata insertion also
  checks the quota atomically. Prepared statements are reused by Bun's SQLite query cache.
- Request-time database initialization is lazy, migrations run once per app process, and public
  page builds do not create a database. Async native password work has a concurrency budget.

`bench/fullstack.ts` compares linear matching and the prior full handler with the updated code.
Raw results, CPU/runtime, baseline commit, source hash, dirty-tree flag and individual samples
are in `bench/fullstack-results.json`. Measurements are warmed in-process static dispatch, not
network throughput, database latency, SSR rendering or a fresh comparison with other frameworks.
Use the separate existing network benchmark for production HTTP claims.

Reproduce against the merged baseline:

```sh
git worktree add --detach /tmp/optz-base f5a5bb0
ln -s "$PWD/node_modules" /tmp/optz-base/node_modules
bun bench/fullstack.ts --baseline /tmp/optz-base --out bench/fullstack-results.json
```


### Measured dispatch result

The final local run used Bun 1.4.4 on AMD EPYC 9V45 96-Core Processor. Five warmed, interleaved samples per case,
median shown. These fixtures request the last static route in a manifest; the middleware case
adds one response-header middleware. Small-manifest differences can be within machine noise.

| Routes | Header middleware | Previous handler µs | Updated handler µs | Ratio |
|---:|---:|---:|---:|---:|
| 10 | 0 | 3.64 | 2.13 | 1.71× |
| 10 | 1 | 3.69 | 3.40 | 1.08× |
| 100 | 0 | 4.75 | 1.83 | 2.59× |
| 100 | 1 | 5.04 | 2.94 | 1.72× |
| 1000 | 0 | 20.34 | 2.11 | 9.64× |
| 1000 | 1 | 20.02 | 3.16 | 6.34× |

The route matcher alone improved more than complete dispatch, because response construction,
security policies and rendering still cost time. No new network req/s, p99 or full-app SSR
performance claim follows from this table. All optional application modules remained off in
these fixtures.

### Verification

- 111 framework tests, 617 assertions; includes persistent-session and two-user application tests.
- Framework and all six applications type-check; all six production builds pass.
- Portfolio browser checks: 30/30; features: 25/25; SPA: 7/7; full-stack registration/notes/upload/
  logout also pass with JavaScript disabled.
- Existing feature app still builds as an edge worker; the SQLite starter targets Bun.
- All 24 package exports import cleanly. Dependency audit reports no known vulnerabilities across
  175 checked packages. No runtime ORM, schema validator or auth SDK was added.
- Existing deployment controller/runner checks pass (13 + 4 Python tests).

## Further work worth doing, with reasons

These are ranked future capabilities, not claims of code shipped in this release:

1. **Established auth integrations.** Better Auth/Auth.js/OIDC adapters, verified email, recovery,
   MFA and passkeys require provider policy and real secrets. Reuse maintained protocols.
2. **A shared production state layer.** Postgres/Redis session/rate-limit adapters and object-store
   storage for multi-node apps. The store contract and data layer are the integration boundaries.
3. **Durable work and scheduling.** Email/webhook retry and long tasks need a durable queue,
   idempotency and a separate worker. `after()`/SSE are not durable jobs.
4. **WebSocket adapter support.** Bun upgrades, per-connection authorization, limits and shutdown
   must be designed together. SSE is implemented for one-way events now.
5. **Asset memory budgets.** Large public media should stream from disk/object storage; the current
   all-in-memory static map suits small sites. Private uploads already stream from storage.
6. **Content collections.** A schema-validated build-time loader layer can replace app-specific
   Markdown code without putting Markdown/MDX dependencies into every application.
7. **Isolated server islands.** Astro-style deferred personalization could keep a public shell
   cacheable, but requires a separate authenticated fragment protocol, not just another Suspense boundary.
8. **Lifecycle and instrumentation adapters.** OpenTelemetry export, graceful shutdown and worker
   draining should be opt-in and cover Bun/compiled/edge targets rather than global mutable hooks.
9. **Response protocol completeness.** Shared encoding-quality negotiation, range requests and
   streaming large assets need correctness tests before advertising file-server parity.
10. **Benchmarks and budgets.** Track network p95/p99, cold starts, RSS under load, protected API
    latency, build time and browser JS alongside dispatch. A routing microbenchmark alone does
    not establish that a complete app is faster than another framework.

Avoid importing a default ORM, globally checking sessions on static requests, hydrating the
whole application for a form, or adding a background process to serve public HTML. These would
spend the framework's existing static-first advantage without solving an application need.

## Primary sources consulted

Official documentation was retrieved directly, with Context7 cross-checks for the three requested
frameworks. These links describe capabilities; they are not performance evidence.

- Next.js: [forms](https://nextjs.org/docs/app/guides/forms), [authentication and DAL](https://nextjs.org/docs/app/guides/authentication), [data security](https://nextjs.org/docs/app/guides/data-security), [instrumentation](https://nextjs.org/docs/app/guides/instrumentation).
- SvelteKit: [form actions](https://svelte.dev/docs/kit/form-actions), [auth](https://svelte.dev/docs/kit/auth), [server-only modules](https://svelte.dev/docs/kit/server-only-modules).
- Astro: [sessions](https://docs.astro.build/en/guides/sessions/), [actions](https://docs.astro.build/en/guides/actions/), [server islands](https://docs.astro.build/en/guides/server-islands/), [content collections](https://docs.astro.build/en/guides/content-collections/).
- React Router: [sessions/cookies](https://reactrouter.com/explanation/sessions-and-cookies), [file uploads](https://reactrouter.com/how-to/file-uploads).
- Nuxt: [server directory](https://nuxt.com/docs/4.x/directory-structure/server), [performance](https://nuxt.com/docs/4.x/guide/best-practices/performance).
- Hono: [streaming](https://hono.dev/docs/helpers/streaming), [CSRF](https://hono.dev/docs/middleware/builtin/csrf), [secure headers](https://hono.dev/docs/middleware/builtin/secure-headers).
- TanStack Start: [authentication](https://tanstack.com/start/latest/docs/framework/react/guide/authentication).
- Bun: [SQLite](https://bun.com/docs/runtime/sqlite).
