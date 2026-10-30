# Optional application modules

Composable application services for OPTZ. All provider work is opt-in.

## Constraints

- Keep default browser output unchanged. No SDK, telemetry, secret loading or database lookup
  enters public static serving merely because a module exists.
- Reuse existing OPTZ storage, response caching, sessions, security and observation.
- Use native APIs and established provider clients instead of new protocols or an ORM.
- Public/admin and upload ownership boundaries require executable tests.

## Available modules

| Entry | What it adds | Default browser cost |
|---|---|---|
| [Environment and Doppler](DOPPLER.md) | Contract validation, normal-command injection, safe CLI management, diff, generated types/public data | None |
| [Uploads](UPLOADS.md) | Direct/multipart S3-compatible transfers, reserved quotas, immutable approval, private downloads | Optional small helper |
| [Page cache / Cloudflare](CLOUDFLARE.md) | Existing cache primitives plus explicit purge and soft invalidation | None |
| [Status pages](STATUS.md) | Persistent components/incidents, admin API and plain SSR view | None required |
| [Analytics](ANALYTICS.md) | Consent-gated capture, trends, funnels, cohorts, local export/delete and injected PostHog adapter | Optional small helper |
| [Database integrations](DATABASES.md) | Native ORM recipes and parameterized/session adapters | None |

The four `@optz/*` packages are workspace source packages under `packages/`, alongside
`@optz/auth`. Use `workspace:*` dependencies here; package publication is a separate release.
The cache integration stays in `optz/cdn` and environment contracts in `optz/env` rather than
adding packages that only re-export existing primitives.

## Example and maintenance

The [auth application](../apps/auth/README.md) reuses real auth sessions and offers public
`/status`, administrator `/modules`, private `/files`, and `/metrics-demo`. No account is an
administrator by default: select a verified user ID in server configuration. Status forms and
insights render without JavaScript. Optional upload/consent islands load only on their routes.
The homepage remains static and does not initialize databases or provider SDKs.

Analytics retention and abandoned uploads require an explicit maintenance schedule.
`apps/auth/scripts/modules-maintenance.ts` demonstrates pruning/cleanup under the same runtime
or Doppler environment. No background process is started by importing a module. Configure
provider-side incomplete-multipart and staging-object lifecycle rules as a backstop.

## Performance and validation

The [recorded browser check](../bench/module-bundles.json) finds the portfolio's default entry
**byte-for-byte unchanged at 6,098 bytes**. Standalone optional exports minify to:

| Helper | Minified bytes | Gzip bytes |
|---|---:|---:|
| `@optz/analytics/client` | 1,009 | 628 |
| `@optz/uploads/client` | 2,408 | 1,255 |

These are standalone helper builds, not whole-page transfer totals; shared Preact, navigation
and application code are separate. AWS/PostHog/auth SDKs, SQLite and Doppler secrets are absent
from these helpers. CI enforces helper-size budgets and fails on server-code markers.

The default static handler source is unchanged. An isolated pre-change source snapshot was
compared on Bun 1.4.4 with one pinned CPU; [raw dispatch results](../bench/module-dispatch.json)
show noisy microsecond timings for identical serving code. No throughput improvement or network/
auth/database performance claim follows from that microbenchmark.

Checks include environment/CLI redaction and dotenv isolation; upload ownership, quotas,
checksums, immutable scanning and cancellation holds; status administrator/origin checks;
analytics consent/DNT/schema/identity and insights; database parameter binding; browser server-only
boundaries; package exports; the existing framework/auth suites; website and example builds;
and the edge build. Run `bun run test:modules`, the framework suite and the docs renderer tests.
Bun **1.4.4 or newer** is required.

## Deliberate boundaries

- Doppler authentication, encrypted fallback storage and advanced config/token operations stay
  in its official CLI. Only explicit PUBLIC_* allowlisted values can enter browser JSON.
- Upload approval is capped at 5 GiB in this implementation to preserve native immutable copy
  semantics. Cancelled reservations stay counted through signed-URL expiry before release.
- A status timeline is not a health probe or proof of 90-day uptime; no synthetic percentage is shown.
- Analytics does not implement replay, heatmaps, flags or a query language. PostHog SDK delivery
  and remote deletion/retention are separate service lifecycle responsibilities.
- Database helpers do not invent an ORM or migration engine. Native clients own pooling and schema.
- Provider tests use fixtures/presigning. Real Doppler projects, object-store CORS/checksum support,
  Cloudflare zone rules and PostHog delivery require account-specific verification before rollout.

## Research notes

Primary references, checked October 30, 2026:

- [Ponytail](https://github.com/DietrichGebert/ponytail/blob/main/skills/ponytail/SKILL.md):
  smallest complete change; reuse before creating abstractions; retain validation and tests.
- [Doppler CLI](https://docs.doppler.com/docs/cli),
  [scoped setup](https://docs.doppler.com/docs/secrets-setup-guide),
  [secret downloads](https://docs.doppler.com/reference/secrets-download): use the official CLI
  for authentication, scoped selection, injection, encrypted fallbacks and secret rotation.
  OPTZ should own the application environment contract, not reimplement Doppler's credential store.
- [S3 multipart limits](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html):
  10,000 parts, 5 MiB minimum except the last. The attached plan's global object-size limit
  is historical; adapters must enforce their configured provider/application limit.
- [Cloudflare purge](https://developers.cloudflare.com/api/resources/cache/methods/purge/),
  [availability/limits](https://developers.cloudflare.com/cache/how-to/purge-cache/),
  [soft invalidation](https://developers.cloudflare.com/api/go/resources/cache/methods/invalidate/):
  limits vary by operation and plan; successful HTTP status alone does not prove eviction.
- [PostHog cookieless tracking](https://posthog.com/tutorials/cookieless-tracking): cookieless
  capture is not the same as consent, and persistent identity still has privacy implications.
  OPTZ's client should send nothing until explicit consent and must not capture arbitrary DOM text.
