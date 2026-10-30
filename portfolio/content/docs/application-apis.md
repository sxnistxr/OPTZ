# Application APIs

The optional APIs added in OPTZ 0.4 cover application state and request handling. Import only what your app uses; public static serving does not initialize these modules.

## Runtime boundaries

| Import | Main exports | Runtime |
|---|---|---|
| `optz/sessions` | `createSessions`, `memorySessionStore`, `SessionStore` | Web Crypto; provide your own persistent store |
| `optz/sqlite` | `openDatabase`, `migrate`, `sqliteSessionStore` | Bun |
| `optz/forms` | `parseInput`, `validateInput`, `ValidationError`, `formValues` | Web-standard Request / FormData |
| `optz/security` | `csrf`, `assertSameOrigin`, `cors`, `secureHeaders`, `createRateLimiter` | Web-standard middleware |
| `optz/storage` | `localStorage` | Node/Bun private local files |
| `optz/stream` | `eventStream` | Web-standard streaming responses |
| `optz/observe` | `observe` | Opt-in middleware |

Keep private modules in `.server.ts` / `.server.tsx` or `app/lib/server/`.
See [Build a full-stack app](full-stack.md) for an executable integration of these APIs.

## Sessions

`createSessions<T>({ store, secure?, name?, maxAge?, now? })` returns `read(request)`,
`create(data, previousRequest?)` and `destroy(request)`. `read` returns a session or `undefined`.
`create` and `destroy` return a **Set-Cookie header value**; attach it to the outgoing response.
The default lifetime is seven days (`maxAge` is in seconds).

```ts
// app/lib/sessions.server.ts — Bun deployment
import { createSessions } from "optz/sessions";
import { openDatabase, sqliteSessionStore } from "optz/sqlite";

const db = openDatabase(process.env.DATABASE_PATH!);
export const sessions = createSessions<{ userId: string }>({
  store: sqliteSessionStore(db),
  secure: true,
  maxAge: 60 * 60 * 24 * 7,
});
```

After verifying credentials, call `sessions.create({ userId }, request)` to mint a fresh token
and revoke the previous cookie's identity. On logout, return `await sessions.destroy(request)`
in `Set-Cookie`. The manager defaults to `__Host-optz_session` on HTTPS, with Secure,
HttpOnly, SameSite=Lax and path `/`. Explicit `secure: false` is for local HTTP development.

A store implements `get(key)`, `set(key, { data, expiresAt })`, and `delete(key)`, synchronously
or asynchronously. Keys are SHA-256 hashes of random 256-bit tokens; `expiresAt` is Unix time
in **milliseconds**. `memorySessionStore(maxEntries?)` is bounded and process-local, for
prototypes/tests. Use persistent shared storage for a distributed application.

## SQLite and migrations

`openDatabase(path)` enables WAL, foreign keys and a 5-second busy timeout. Initialize state
lazily if public builds should not create a database. `migrate` applies numbered SQL changes
inside an immediate transaction and rejects changed checksums or out-of-order insertions.

```ts
import { openDatabase, migrate } from "optz/sqlite";

const db = openDatabase(process.env.DATABASE_PATH!);
migrate(db, [{
  id: 1,
  sql: `CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    title TEXT NOT NULL
  )`,
}]);

// Authenticate first; constrain each data operation by the authenticated owner.
export function notesFor(userId: string) {
  return db.query("SELECT id, title FROM notes WHERE user_id = ?").all(userId);
}
```

Add new migration IDs rather than modifying applied SQL. This adapter targets one Bun machine
with persistent disk; other databases remain an application integration.

## Input validation

`parseInput(request, validator, { maxBytes?, timeoutMs? })` parses JSON, URL-encoded forms and
multipart forms. Its validator can implement Standard Schema V1 (for example Zod or Valibot),
or be a synchronous/asynchronous function. TypeScript annotations do not validate requests.

```ts
// app/api/preview.ts — validates input; does not persist anything
import type { ApiContext } from "optz";
import { parseInput, ValidationError } from "optz/forms";

export async function POST({ request }: ApiContext) {
  const values = await parseInput(request, input => {
    const title = (input as Record<string, unknown>)?.title;
    if (typeof title !== "string" || !title.trim() || title.length > 200) {
      throw new ValidationError({ title: ["Enter a title of 1–200 characters"] });
    }
    return { title: title.trim() };
  }, { maxBytes: 8192 });
  return Response.json(values, { headers: { "Cache-Control": "no-store" } });
}
```

Validation errors become safe 422 JSON responses with a `fields` map. Malformed input,
oversized input and unsupported content types produce 400, 413 and 415 respectively.
Input values are not echoed automatically. Repeated form fields become arrays.
Use `validateInput(validator, value)` when parsing is already handled, or `formValues(formData)`
to preserve repeated fields. Add authentication, ownership checks and CSRF before persisting mutations.

## Request security

`csrf(origin)` checks unsafe request methods against your configured public origin.
`secureHeaders(overrides?)` adds nosniff, a referrer policy and frame denial; provide your own
Content-Security-Policy appropriate to the application. `cors({ origins, credentials?, methods?,
headers? })` uses explicit origins and handles allowed preflights; wildcard origins are rejected.

```ts
// app/middleware.ts — configure PUBLIC_URL before starting the app
import { csrf, secureHeaders } from "optz/security";

export default [
  csrf(process.env.PUBLIC_URL!),
  secureHeaders(),
];
```

`createRateLimiter({ limit, windowMs, maxKeys?, now? }).consume(key)` returns
`{ allowed, remaining, retryAfter }`, with retry seconds. It uses bounded fixed windows and
refuses new keys when full. Choose short trusted identity keys; unverified forwarded headers
are not identities. The limiter is local to one process.

## Private attachments

`localStorage(directory)` from `optz/storage` returns `save(file, options?)`,
`response(key, downloadName?)` and `remove(key)`. This is private server file storage, unrelated
to the browser's `window.localStorage`.

```ts
// app/lib/files.server.ts
import { localStorage } from "optz/storage";

export const files = localStorage(process.env.UPLOAD_DIR!);
export async function saveTextAttachment(file: File) {
  return files.save(file, { maxBytes: 1 << 20, types: ["text/plain"] });
  // Returns { key, size, name, type }; persist ownership with this metadata.
}
```

Writes use random keys, private permissions and streaming size limits. Reads reject symlinks
and return attachment-only responses with nosniff and private/no-store. Authorize the owner
before calling `response`, enforce quotas and bound concurrent uploads in your app. A MIME
allowlist checks declared transport types; it is not file-content inspection. Keep the
directory outside `public/`. See the [starter upload route](../../../apps/fullstack/app/api/files.ts).

## Server-sent events

`eventStream(request, source, { maxEventBytes?, onClose? })` converts an async iterable of
`{ data, event?, id?, retry? }` into SSE. The default maximum encoded event is 64 KiB.
Events are pulled with backpressure; metadata is checked for invalid framing.

```ts
// app/api/ticks.ts — public example, Bun/Node timer implementation
import type { ApiContext } from "optz";
import { eventStream } from "optz/stream";
import { setTimeout } from "node:timers/promises";

export function GET({ request }: ApiContext) {
  return eventStream(request, async function* (signal) {
    while (!signal.aborted) {
      yield { event: "tick", data: { time: Date.now() } };
      try { await setTimeout(10000, undefined, { signal }); }
      catch { return; }
    }
  }, { maxEventBytes: 4096 });
}
```

Observe the supplied signal during pending work. Use `onClose` to release connection budgets.
For private events, authenticate before opening the stream and recheck expiry/revocation while
it runs, as the [starter does](../../../apps/fullstack/app/api/events.ts). SSE does not provide
durable pub/sub, bidirectional WebSockets or a task queue.

## Request observation

`observe({ onRequest?, onError? })` adds `X-Request-Id` and `Server-Timing`. Events contain an ID,
method, pathname and duration; successful response events also include status. Query strings,
credentials and bodies are excluded. Callback failures are caught and logged.

```ts
import { observe } from "optz/observe";

export default [observe({
  onRequest: ({ id, method, pathname, status, durationMs }) => {
    console.log(JSON.stringify({ id, method, pathname, status, durationMs }));
  },
})];
```

Callbacks do not delay response completion. This is an integration hook, not a bundled
telemetry backend or a delivery guarantee. Combine it with your other middleware in one array.
