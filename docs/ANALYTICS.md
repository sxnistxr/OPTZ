# Consent-first analytics

`@optz/analytics` supplies bounded event ingestion, local trends, ordered funnels and retention
cohorts. It adds no tracking code by default. The optional browser helper sends nothing until
explicit consent and uses an in-memory identity, without cookies or local/session storage.

## Declare the allowed events

```ts
// app/lib/analytics.server.ts
import { createAnalytics } from "@optz/analytics";
import { sqliteAnalyticsStore } from "@optz/analytics/sqlite";
import { openDatabase } from "optz/sqlite";

const db = openDatabase(process.env.ANALYTICS_DATABASE_PATH!);
export const analytics = createAnalytics({
  store: sqliteAnalyticsStore(db),
  secret: process.env.ANALYTICS_HASH_SECRET!,
  origin: process.env.PUBLIC_URL!,
  retentionDays: 30,
  events: {
    page_viewed: { route: ["/", "/pricing", "/account"] },
    started: { plan: ["free", "paid"] },
    completed: { amount: "number", trial: "boolean" },
  },
});
```

Properties must be numbers, booleans or explicit string enums. Unknown fields and common
personal/secret field names are rejected. There is no arbitrary DOM text, form-value, query,
referrer or IP capture. Do not put personal data into your schema's enums or event names.
Use a random, persistent hashing secret of at least 32 characters, supplied through
[Doppler](DOPPLER.md) or the runtime environment.

## Ingest and opt in

```ts
// app/api/analytics.ts
import type { ApiContext } from "optz";
import { analytics } from "$lib/analytics.server";
export const POST = ({ request }: ApiContext) => analytics.ingest(request);
```

```ts
// Optional browser code, loaded only where the product needs analytics.
import { createAnalyticsClient } from "@optz/analytics/client";

const analytics = createAnalyticsClient({
  endpoint: "/api/analytics",
  events: ["page_viewed", "started", "completed"],
});

// Call only after the reader makes a consent choice.
analytics.setConsent(true);
await analytics.page("page_viewed", "/pricing");
await analytics.capture("started", { plan: "free" });
analytics.setConsent(false);
```

DNT and Global Privacy Control take precedence. Revoking consent rotates the in-memory identity.
`identify(opaqueId)` is optional and consent-gated; use an opaque account identifier, never an
email/phone. The server stores an HMAC of that identifier, not the incoming ID. Pseudonymization
is not anonymization; identity and consent policy remain application responsibilities.

Page views are opt-in calls with a safe route pattern, not a read of the current URL. Optional
`clicks(root)` listens only to an explicit `data-analytics-event` attribute and returns cleanup;
it never reads labels, input values or link URLs. The server still enforces the event schema.
There is no session replay, heatmap, experiment engine or background SDK initialization.

Ingestion requires POST, same origin, `consent: true`, an opaque identifier and valid schema.
It checks DNT/GPC, caps input at 8 KiB, uses server timestamps, rate-limits a bounded shared
ingestion budget and returns no-store responses. Deploy a shared/ingress budget for replicas.
Direct server-side `capture` is a trusted API: obtain consent/policy authorization before calling it.

## Query insights on the server

```ts
const end = Date.now();
const start = end - 7 * 86400000;
const trend = await analytics.trends("page_viewed", start, end);
const funnel = await analytics.funnel(["page_viewed", "started", "completed"], start, end);
const cohorts = await analytics.retention("page_viewed", "page_viewed", start, end);
```

Trends count events in fixed UTC-aligned buckets (one day by default). Funnels count distinct
pseudonymous subjects reaching each step in order within the configured window; each subject
counts at most once per step. Retention groups a subject's first qualifying start in the query
range into a cohort, then counts returns per period. Day zero is included; these are cohorts
within the selected range, not a claim to first-ever lifetime acquisition.

Reads are bounded to 100,000 events and a maximum 366-day range; narrow the range if exceeded.
The SQLite adapter uses indexed time/subject access and an atomic event-capacity counter.
`@optz/analytics/view` exports `TrendChart`, a server-rendered table with native meters and no
charting runtime. Insight routes must enforce administrator access; ingestion does not expose
an unauthenticated dashboard.

## Retention, export and deletion

`exportSubject(opaqueId)` and `deleteSubject(opaqueId)` hash through the same secret. Authenticate
the caller and derive the identifier from the trusted session, never from a caller-supplied
account ID. The auth example's `/api/analytics/privacy` implements this boundary.

Retention is 30 days by default (configurable 1–365). Capture prunes at most once per minute.
Schedule `analytics.prune()` as well so old rows are removed even when a site stops receiving
events. No timer starts on import. Backups have their own retention policy. Rotating the hash
secret intentionally unlinks identities; keep a controlled migration/deletion plan for old hashes.

## PostHog and dual writes

Inject the official server SDK; the adapter does not make it a dependency of every OPTZ app:

```ts
import { PostHog } from "posthog-node";
import { posthogAdapter } from "@optz/analytics/posthog";

const posthog = new PostHog(process.env.POSTHOG_PROJECT_TOKEN!, {
  host: process.env.POSTHOG_HOST!,
});
// In createAnalytics options:
const adapters = [posthogAdapter(posthog)];
```

Local capture succeeds before adapter delivery. The adapter sends only the accepted event,
hashed subject and explicit properties, disables geographic lookup and requests no person
profile. SDK delivery failures/queue flushing belong to the injected client's lifecycle;
`onAdapterError` can observe synchronous/awaited adapter failures without exposing provider details.
This is not an atomic transaction or durable delivery queue. Call the official SDK's shutdown
hook in an appropriate worker lifecycle.

Local export/delete does not silently claim to delete a remote PostHog copy. Configure external
retention, data region, consent and deletion/export workflows in that service too. Apps that
choose the full browser SDK can load it after consent using PostHog's documented privacy
options; it is deliberately not bundled into this small helper.

Primary references: [PostHog cookieless modes](https://posthog.com/tutorials/cookieless-tracking),
[JavaScript SDK](https://posthog.com/docs/references/posthog-js),
[Node SDK](https://posthog.com/docs/libraries/node).
