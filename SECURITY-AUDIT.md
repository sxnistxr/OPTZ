# OPTZ security and architecture audit

Reviewed 2026-10-28 at commit `510e4e5637bf969f937550f79f2ac0e7e519e01b`.

Scope: the portfolio application, reusable Bun framework, Rust/SQLite engine, social demo, and deployment/runner tooling. This is a source review with local reproductions, not a penetration test of the deployed VPS. No production endpoints or credentials were used. No application source was changed.

## Remediation — implemented in this workspace

All eight findings below have source-level fixes and regression coverage. This section supersedes
the original audit's statements about unchanged source. The original findings remain as the
before-change evidence; this is not a claim that an existing VPS has been upgraded.

| Finding | Remediation | Verification |
|---|---|---|
| F1 | Credentialed requests bypass sharing; anonymous private results rerun each caller's producer; all request headers partition server entries; raw header reads and session creation force private/no-store | Concurrent distinct users, cookies, cold Vary, raw Request reads, session creation |
| F2 | Page JSON, OG and locale variants resolve their logical route before middleware | Both static and dynamic data return 403 under the page policy |
| F3 | Scoped middleware checks source and internal rewrite destinations before dispatch | Multi-hop aliases and source restrictions tested; endpoint dispatch occurs once |
| F4 | HTTPS-only image fetching validates every redirect, refuses special-use IPs, and validates the DNS results used by the socket | Redirect scheme/host/port/credential tests, IP tests and actual Bun HTTPS loopback-DNS rejection |
| F5 | Downloads enforce streaming byte/time limits; image jobs and pre-buffer queues are bounded; source downloads are coalesced; LRU accounting replaces existing entries correctly | Chunked overflow cancels reads, declared lengths checked before consumption, overload returns 503 |
| F6 | HTTP runner replaced with SSH forced-command tasks under an unprivileged identity; strict host-key checks and fixed argv, no caller shell strings | Python tests for fixed argv, rejected task/host injection and root refusal |
| F7 | HTTP listener and thread-per-connection service removed; SSH task execution has deadlines, output/process limits and a cross-session lock | Python output/deadline tests; no persistent job/log API remains |
| F8 | Generated nginx enables upstream certificate verification, SNI, hostname and explicit trust bundle; custom CA CLI option supported | Generated-config assertions for HTTPS versus HTTP and custom CA |

Additional architecture changes:

- Revalidation callbacks, draft signers, memoized request-time data caches, image caches/pools,
  and SSR image sizes now belong to the app rather than last-created global configuration.
  Multi-app regressions cover independent environments, callbacks and draft cookies.
- Shared stream limits cover proxy uploads and MCP bodies; MCP batch fan-out is capped at 32.
- Repository Markdown HTML is sanitized through a strict tag/attribute/URL allowlist.
- Automatic root branch deployment and repository hooks are retired. Deployment configuration
  executes as the unprivileged app user. Migration and reviewed-release documentation replace
  the automatic polling instructions.
- Security regressions and administrative tooling checks are included in CI.

### Required VPS migration

These commands are instructions for an administrator on the VPS; they were not run here:

1. Update to a reviewed release containing these changes and deploy it using `ops/deploy.sh`.
2. Run `sudo bash deploy/setup-vps.sh` to disable the old root branch-polling timer/service.
3. Disable the old HTTP runner with `sudo systemctl disable --now optz-runner.service`.
   If administrative tasks are needed, install the SSH replacement with
   `sudo bash ops/runner/install.sh /path/to/client-key.pub`, then configure only fixed trusted
   commands in root-owned `/etc/optz-runner/tasks.json`. Remove the obsolete HMAC secret.
4. Enroll the SSH server host key through a trusted channel. Existing arbitrary shell/job clients
   must migrate to `remote.py run TASK` with `RUNNER_SSH_HOST`.
5. Reload the regenerated nginx configuration and purge any existing shared response/CDN caches.

### Remediation checks

- Full framework suite: **97 pass, 0 fail, 427 assertions**. Python runner suite: **4 pass**.
  Shell syntax checks pass. Final framework output: `/workspace/scratch/optz-security-final-tests.log`.
- Framework and all five apps type-check; all five production builds pass.
- Portfolio, features demo and SPA browser suites pass. Logs are under `/workspace/scratch/*-security-e2e.log`.
- Package export checks pass (17 exports); dependency audit reports no known vulnerabilities
  across 175 checked packages.
- Production service migration, live nginx TLS handshakes, SSH server installation and Rust
  runtime/FFI validation were not performed in this workspace. No Rust vulnerability was
  established by the audit; performance instrumentation/fuzzing remain future engineering work.

## Main result

Fix response-cache isolation and authorization across alternate route representations first. Both fail in local reproductions. The portfolio currently has global security-header middleware, public content, and dynamic rendering disabled; the tests demonstrate framework vulnerabilities, not observed theft of private portfolio data.

Other findings depend on enabling remote images, HTTPS upstream proxies, or installing the remote runner. Deployment state was not verified.

## Findings

### F1 — High: concurrent cache misses share private responses across users

Locations: `framework/src/cache.ts:120–128,147–150`; integration at `framework/src/handler.ts:539–554`.

The cache joins requests by URL and configured vary fields before it knows whether the response is safe to share. If the result is private, no-store, sets a cookie, or varies on Cookie/Authorization, it clones that same response for every waiting request. Refusing to persist the response does not prevent an immediate disclosure.

**Reproduction:** a blocked Alice request and simultaneous Bob request for the same cache key returned Alice's private body and `Set-Cookie: session=alice` to Bob. Bob's producer never ran. This requires a cache-enabled route whose key does not already partition those users. The existing private-response test exercises identical callers and misses this distinction.

**Fix:** opt credentialed requests out of cross-request coalescing by default. When a result is unshareable, run each waiter's producer independently rather than copying the first response. Response-learned Vary fields also need to partition/retry already waiting requests, not just future lookups. Explicitly authorize public coalescing; add tests with distinct users and sessions.

### F2 — High: page data URLs bypass path-scoped authorization middleware

Locations: `framework/src/handler.ts:56–61,574–598,923–925`.

Middleware matchers examine the incoming URL. The loader data endpoint decodes a different destination afterward. Middleware protecting `/admin/[...rest]` therefore does not run for `/_optz/data/admin/secret.json`, although that endpoint executes the protected page's loader or serves its prebuilt data.

**Reproduction:** `/admin/secret` returned 403, while its data endpoint returned 200 and private content. Tested both prebuilt data and a real dynamic page loader.

**Fix:** resolve the logical destination before authorization, and apply the same route policy to HTML, data, locale variants, and other representations. Keep transport-specific middleware separate. Until then, enforce authorization inside sensitive loaders as well as middleware, and do not prerender sensitive data.

### F3 — High: internal rewrites bypass destination middleware

Location: `framework/src/handler.ts:758–769`.

A rewrite re-enters `route()` directly, after middleware has run on the source URL. An unprotected alias to an otherwise protected endpoint does not inherit the endpoint's middleware check.

**Reproduction:** with an internal rewrite from `/public-alias` to `/admin/secret`, the direct endpoint returned 403 and the alias returned the protected API body with status 200.

**Fix:** authorize the resolved destination before dispatch, preserving loop bounds and request context. Avoid blindly rerunning middleware that may have mutation side effects; centralize route authorization as a distinct step.

### F4 — High, conditional: image redirect following escapes the host allowlist

Location: `framework/src/image.ts:80–95`.

Only the initial URL is checked for HTTPS and membership in `images.remoteHosts`. Fetch uses automatic redirects. A permitted server's open redirect or attacker-controlled resource can redirect to another host, an HTTP endpoint, or an internal service. Hostname checks alone also do not constrain DNS resolutions to public addresses. Returned SVG/GIF content is passed through, and other unprocessable responses are fetched before encoding rejects them.

**Exposure:** remote images must be enabled with an allowed host that supplies such a redirect or unsafe resolution. The portfolio does not configure remoteHosts. This finding is based on source tracing and Fetch behavior; no internal network requests were attempted.

**Fix:** use manual redirect handling with a small hop limit; revalidate scheme, host, port, and destination addresses at every hop. Prevent DNS rebinding with address-pinned connections or a constrained egress proxy. Default-deny loopback, private, link-local, and metadata destinations.

### F5 — Medium, conditional: image fetching and queues are not memory-bounded

Locations: `framework/src/image.ts:31–38,88–93,107–139`.

For responses without a trustworthy Content-Length, the 20 MiB limit is checked after `arrayBuffer()` has read the whole body. A remote server can exceed the intended allocation limit. Remote fetching also happens before the encode cache/inflight lookup, while the encode waiting list has no admission cap. Concurrency limits only bound active encoders, not downloads or queued input buffers.

**Exposure:** attacker-influenced content on an allowed remote host; repeated local image transformations can also pressure the unbounded queue. Not load-tested against production.

**Fix:** stream into a byte-counted reader and cancel at the limit. Bound total downloads, queued jobs, and retained bytes; reject overload with 429/503. Deduplicate source downloads before buffering and use a bounded source cache. Maintain cache byte accounting once per insertion rather than once per waiter.

### F6 — High, deployment-dependent: a root shell runner uses plaintext HTTP

Locations: `ops/runner/install.sh:15–18`; `ops/runner/runner.py:60–65,105–115,156`; `ops/runner/remote.py:13–30`.

The installer defines no User, so systemd runs the runner as root. It listens on all interfaces and intentionally executes authenticated shell commands. Requests are HMAC-signed with timestamp and nonce checks, but HTTP exposes commands/results and the client does not authenticate responses. An on-path attacker can read sensitive output or replace results, including presenting false success. HMAC request authentication does not provide transport confidentiality or response integrity.

**Important distinction:** arbitrary command execution is the runner's intended authenticated capability. No HMAC bypass or unauthenticated command execution was found. Whether this runner is installed/reachable is unknown.

**Fix:** remove it from production when unused. Otherwise put it behind authenticated TLS or a private encrypted administrative channel, bind privately, use a dedicated unprivileged identity, and allowlist the minimum required operations. Do not accept secrets as command-line installer arguments.

### F7 — Medium, deployment-dependent: unauthenticated runner connections can retain unbounded threads

Locations: `ops/runner/runner.py:77–98,156`.

`ThreadingHTTPServer` creates a thread per connection. No socket read deadline or connection cap is installed. The handler waits for the declared body before verifying the signature. A slow unauthenticated client can retain threads by declaring a body and withholding bytes; a negative Content-Length is also not rejected and reaches `read(-1)`. The one-second sleep on failed authentication retains threads rather than imposing a global rate limit.

**Fix:** reject malformed, negative, duplicate, or oversized lengths; enforce header/body deadlines and connection/concurrency caps at a reverse proxy and the service. Bound authenticated job count, output capture, log growth, and retention too. Source-confirmed; no traffic flood was performed.

### F8 — High, conditional: generated nginx HTTPS upstreams do not verify certificates

Location: `framework/src/nginx.ts:72–86`.

The HTTPS branch enables SNI and sets the server name, but never enables `proxy_ssl_verify` or configures a trust bundle. nginx defaults upstream certificate verification to off. Under the standard generated configuration, a network attacker between nginx and an HTTPS upstream can impersonate that upstream and read forwarded credentials or modify responses.

**Exposure:** requires an HTTPS proxy target and no enclosing configuration that enables verification. The social demo currently uses a loopback HTTP target; this is a framework generator vulnerability, not a demonstrated breach of that demo.

**Fix:** generate `proxy_ssl_verify on`, the system CA bundle path, and an appropriate verification depth, retaining SNI/name checking. Make any private CA override explicit. Test the generated config against a trusted certificate and a wrong-host/self-signed certificate.

## Architecture improvements, in priority order

1. **One route-resolution and authorization pipeline.** Resolve source URL, rewrites, locale, logical route, and representation before dispatch. Reuse an explicit route access policy for HTML, loader JSON, MCP page reads, and rewrites. F2 and F3 are symptoms of different entry paths enforcing different policies.
2. **Make caching opt-in for public results.** Separate request-private computation from public response storage. Decide whether callers can share work before coalescing them. Track all response inputs explicitly: route, representation, query, locale, and authorized vary dimensions. Direct reads through `ctx.request` or middleware locals are not fully covered by the headers()/cookies() read tracker.
3. **Move application state out of module globals.** `context.ts:40–46` holds one process-wide revalidator; `server-api.ts:101–105` holds one draft-token factory; image caches/pools and image sizes are also global. Multiple `createApp()` instances can overwrite callbacks or share resource budgets. Store these services on each app and carry them through request context; test two apps in one process.
4. **Separate administrative tooling from the app.** Remove the public root runner from the application deployment path. Prefer immutable CI-built releases promoted by digest to a deployment service with constrained privileges. The legacy `deploy/setup-vps.sh`/`sync.sh` service runs repository hooks as root and advances the working copy before hook success; a failed hook is not retried when HEAD already matches. Consolidate it with the release/rollback flow under `ops/`.
5. **Apply budgets before allocation and fan-out.** Use shared bounded-body and queue primitives for images, proxy buffering, MCP batches, and administrative jobs. The Rust engine already has connection admission, bounded write jobs, and partial-request stall handling; mirror that discipline in Bun and tooling.
6. **Keep the Rust boundary narrow and measurable.** The engine's SQL uses prepared statements and bound values, JWT verification checks HMAC/algorithm/expiry, and production systemd units include substantial hardening. Preserve these properties. Its synchronous SQLite reads and 5-second busy timeout run on the network thread; instrument tail latency under contention before adding threads/sharding. Add parser fuzzing, queue stress tests, and unsafe/FFI validation alongside existing protocol tests.
7. **Expand security regression coverage.** Test distinct identities concurrently, alternate URL representations, rewrite destinations, hostile image redirects/streams, and HTTPS upstream identity failures. Existing tests cover useful functionality but do not catch the confirmed isolation failures. Keep repository Markdown trusted-only: it is rendered as HTML without a sanitizer; add sanitization and URL-scheme validation before accepting external authors/content.

## Validation and limits

- Graphify local AST extraction: 246 code files, 1,927 nodes, 4,107 edges. Queried for request handling, middleware, JWT, proxy, image, and deployment relationships. No LLM/API extraction cost. SQL extraction lacked its optional parser, and 25 files yielded no symbols; config/deployment files were inspected directly. Graph edges guided navigation; source and reproductions determined findings.
- RTK used for source inspection, directory/status checks, tests, and dependency audit.
- `bun test` in `framework/`: **78 pass, 0 fail, 316 assertions**, including all existing cache, route configuration, and proxy tests.
- `bun audit`: **no known vulnerabilities across 175 packages**. This does not establish absence of application logic vulnerabilities.
- Local reproducer: `/workspace/scratch/optz-security-poc.ts`. Run after `source /workspace/.tools/optz-env.sh` with `bun /workspace/scratch/optz-security-poc.ts`. All four checks confirmed the vulnerable behavior (private-response sharing, static data bypass, rewrite bypass, dynamic loader bypass).
- Full framework test output: `/workspace/scratch/optz-audit-tests.log`.
- Rust code was reviewed statically; Rust tests, cargo advisory checks, runtime memory-safety analysis, browser E2E, actual nginx TLS handshakes, live origin TLS/firewall settings, and VPS service state were not verified. No claim of a clean bill of health for those areas.
- Graphify artifacts are in `graphify-out/` (ignored by this repository). Report and local proof scripts contain no production secrets. Fixes are recommended, not applied.
