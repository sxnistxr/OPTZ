# Build a full-stack app

OPTZ 0.4 adds optional sessions, SQLite, input validation, private files, server-sent events and request observation. Start with a working app, then adapt its data layer.

## Create the application

From the repository root, with workspace dependencies installed:

```sh
bun framework/src/cli.ts create apps/my-app --template fullstack
cd apps/my-app
bun install
cp .env.example .env
bun run dev
```

Open the address printed by the dev server. The full-stack starter uses port 3007 by default.
Register an account with a password of at least 12 characters, create a note, attach a file,
then log out and back in. The forms also work with JavaScript disabled.

To explore the checked-in version instead, run those install/dev commands inside `apps/fullstack`.
The [starter's README](../../../apps/fullstack/README.md) lists endpoints, quotas and configuration.

## What the starter includes

| Capability | Implementation |
|---|---|
| Public pages | Static HTML; no database initialized by the landing page build |
| Accounts | Bun Argon2id password hashes with a bounded password-work budget |
| Sessions | Random tokens, hash-only SQLite records, expiry, identity rotation and logout revocation |
| Private notes | Create, list, toggle and delete; every query constrains the authenticated owner |
| Attachments | Private files, bounded multipart input, per-user quotas and owner-checked downloads |
| Live updates | Authenticated SSE note counts; streams stop after disconnect, expiry or revocation |
| Forms | Native form posts; runtime validation and safe field errors for API clients |
| Request protections | Same-origin mutation checks, response headers and bounded local limits |

These modules are separate imports. A static site does not open a database, check a session,
or start a stream just because the framework supports them.

## Keep data access on the server

Use `.server.ts` / `.server.tsx` files or the `app/lib/server/` directory for database,
session and private storage code. The browser build rejects these modules even through a
transitive shared import. Imports removed with a route's server-only loader stay on the server.

The starter centralizes its state and `requireUser(request)` in
[`app/lib/app.server.ts`](../../../apps/fullstack/app/lib/app.server.ts). Check the session
again at each protected loader, API route and mutation, then constrain access by owner in SQL.
A hidden button or a protected layout alone is not authorization.

Read the [application API guide](application-apis.md) for the exported helpers and their runtime boundaries.

## Configure persistent state

The local `.env` points at a loopback origin and `.data/`. For deployment, configure the exact
external HTTPS origin and writable paths outside your release directory:

```sh
PUBLIC_URL=https://your-app.example
DATABASE_PATH=/var/lib/your-app/app.sqlite
UPLOAD_DIR=/var/lib/your-app/uploads
MAX_USERS=100
MAX_STORAGE_BYTES=104857600
```

`PUBLIC_URL` determines CSRF checks and secure cookie behavior. The starter enables host-only
Secure, HttpOnly, SameSite=Lax session cookies on HTTPS. `MAX_USERS=0` closes public registration.
The default limits are 100 accounts and 100 MiB of attachments.

Deploy the SQLite starter as its own **Bun service with persistent storage**. The framework's
edge target does not make `bun:sqlite` or local file storage portable. Back up the database
using SQLite's online backup API and back up uploads as well. Add numbered migrations; do not
edit migrations that have already run.

## Know the integration boundaries

The starter includes password login, not email verification, password recovery, OAuth, MFA,
invites or account administration. Integrate a maintained identity provider when those are
part of your product. The [session store contract](application-apis.md#sessions) lets you
replace persistence without changing cookie handling.

Local request limits and connection budgets are per process. Multiple replicas need shared
sessions, rate limits and storage. SSE is a live response stream; `after()` is a response
lifecycle hook. Neither provides a durable queue or guaranteed background delivery.

## Verify your changes

```sh
bun run check
bun run build
```

In the repository, `framework/test/fullstack.test.ts` covers primitives and
`framework/test/fullstack-app.test.ts` exercises two users, access denial and restart persistence.
`apps/fullstack/e2e.cjs` walks registration, notes, uploads and logout with JavaScript disabled.
See [Contributing](contributing.md) for the complete check workflow.
