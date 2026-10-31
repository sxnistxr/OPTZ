# Status pages

`@sxnistxr/optz-status` provides component states, incident timelines and an authenticated update API.
Its public view is plain server-renderable React: no polling, status SDK or island is required.

## Store and render

```tsx
import { openDatabase } from "optz/sqlite";
import { sqliteStatusStore } from "@sxnistxr/optz-status/sqlite";
import { StatusPage } from "@sxnistxr/optz-status/view";

const db = openDatabase(process.env.STATUS_DATABASE_PATH!);
const store = sqliteStatusStore(db);
const snapshot = await store.snapshot();
const page = <StatusPage snapshot={snapshot} title="Service status" />;
```

In a route, keep database setup in a `.server.ts` module and return the snapshot from a dynamic
loader. The view inherits the application's styling. `overallStatus(components)` prioritizes
outage, degraded, maintenance, then operational. Components are explicitly managed states,
not automatic health probes.

## Protect updates

```ts
import { createStatusHandler } from "@sxnistxr/optz-status";
import { getAuth } from "./auth.server";

const handler = createStatusHandler({
  store,
  origin: process.env.PUBLIC_URL!,
  prefix: "/api/status",
  authorizeAdmin: async request => {
    const session = await getAuth().getSession(request);
    return session?.user.emailVerified && session.user.id === process.env.ADMIN_USER_ID
      ? { id: session.user.id }
      : null;
  },
});
```

An authenticated account alone is not an administrator. The application must enforce its
trusted role/allowlist and can require fresh authentication or MFA through `requireSession`.
No account gains administrator rights by being first to register.

| Endpoint | Behavior |
|---|---|
| `GET /api/status` | Read-only public snapshot, no-store, bounded shared request budget |
| `POST /api/status/components` | Upsert `id`, public `name`, `status` |
| `POST /api/status/incidents` | Create `title`, public `message`, `status` |
| `POST /api/status/incidents/ID` | Append `message` and new `status` |

Component states: operational, degraded, outage, maintenance. Incident stages: investigating,
identified, monitoring, resolved. Input supports JSON or native forms and is bounded to 12 KiB.
Mutations require a configured Origin, valid administrator and bounded per-admin request budget.
The store records the actor for audit, but public snapshots omit actor identities.

The SQLite adapter keeps component changes and incident updates transactional. Public output
includes at most 30 incidents and the latest 100 updates per incident. The view escapes public
text normally through React. Keep sensitive internal remediation details out of public messages.
Use the `StatusStore` interface for a different database or ORM.

## Hosting and operational meaning

Host a production status page separately if it must survive an outage of the service it
describes. A status page running on the same server cannot independently demonstrate resilience.
These modules do not invent a 90-day uptime percentage from a few status updates. Integrate
an external probe history if measured availability is required; retain its dates and observation
coverage. Status audit/history retention is an operator policy, not an unannounced background job.

The [auth example](../apps/auth/README.md) includes public `/status` and protected `/modules`
pages. Native administration forms work without browser JavaScript. Existing rate limits are
process-local; use a trusted ingress/shared limiter for multiple replicas.
