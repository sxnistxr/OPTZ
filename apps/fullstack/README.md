# OPTZ full-stack starter

Accounts, revocable SQLite sessions, private notes, private attachments, and an SSE endpoint.
Pages and forms work with JavaScript disabled. No ORM, auth SDK or validation package is required.

```sh
bun install
cp .env.example .env
bun run dev
```

Open **http://127.0.0.1:3007**. Register with an email address and a password of at least 12 characters.
The landing page is static. Login and dashboard pages render on the server; database queries and
password hashing stay on the server. Login errors redirect back to an accessible error message.
JSON/form validation helpers can return structured field errors to API clients.

## State and deployment

`.data/` contains the default SQLite database and private uploads, is ignored by Git, and is never
copied into `public/` or the browser bundle. For production, set:

```sh
PUBLIC_URL=https://your-app.example
DATABASE_PATH=/var/lib/your-app/app.sqlite
UPLOAD_DIR=/var/lib/your-app/uploads
```

Use HTTPS: the configured HTTPS origin enables host-only `__Host-` Secure/HttpOnly/Lax cookies.
`PUBLIC_URL` is the exact external origin used for CSRF checks; do not derive it from forwarded
headers sent by callers. The default HTTP origin is only for the local loopback server.
Make the data directory writable by the service user and keep it outside immutable releases.
Back up the database using SQLite's online backup API, plus the upload directory; copying a live
WAL database without its WAL is unsafe. Deploy this app as its own Bun service: the repository's
production migration currently deploys the portfolio, not every demo application.

SQLite connections and schema migrations initialize lazily at the first data request. Migrations
are transactional and checksum-protected. Add new numbered migrations instead of editing an
already applied migration. The dashboard and every data mutation independently validate the
session; every notes/files query constrains the authenticated owner in SQL.

## Endpoints

- POST `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`: native forms or form/JSON input.
- POST `/api/notes`: create; POST `/api/notes/ID` with `operation=toggle|delete`: update/delete.
- POST `/api/files`: multipart `file`, at most 5 MiB, allowlisted transport MIME types.
- GET `/api/files/KEY`: authenticate ownership and serve as an attachment with nosniff.
- GET `/api/events`: authenticated SSE note counts; aborted/logged-out/expired sessions stop streaming.

The starter bounds password work, uploads and SSE connections per process. Notes and attachment
counts have per-user quotas. Default app-wide caps are 100 registered users and 100 MiB of
attachments (`MAX_USERS`, `MAX_STORAGE_BYTES`); set `MAX_USERS=0` to close public registration. The default authentication limiter is a process-wide budget of 60
requests per minute; it deliberately ignores forgeable IP headers. For multiple replicas, inject
a shared limiter/store (e.g. Redis/Postgres), or rate-limit at your trusted ingress. SQLite is for
a single machine with persistent storage; use the session store contract for distributed apps.

The minimal auth flow does not implement email verification, password recovery, OAuth, MFA,
invites or account administration. Add a maintained provider for those product requirements;
do not treat public self-registration as a verified identity. Password hashes use Bun's native
Argon2id implementation. Session tokens are random 256-bit values; only their hashes are stored.
MIME declarations are not content inspection: uploads remain private attachment-only responses.

Run `bun run check`, `bun run build` and your integration tests before deployment.
