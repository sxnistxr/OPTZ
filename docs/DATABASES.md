# Database and ORM integrations

OPTZ does not wrap your application's query language or own its connection pool. Use Prisma,
Drizzle, Kysely, TypeORM or native clients in server-only modules. `@sxnistxr/optz-db` adds small session
store adapters where serialization, expiry units and parameter binding have real value.

## Where the adapter fits

```flow
title: The session adapter bridges OPTZ sessions and the database client you already use.
Sessions | `createSessions` | Cookies, rotation and expiry checks
Adapter* | `SessionStore` | Hashed keys and serialized session rows
Database | Your ORM or driver | Connections, queries and migrations
```

Use your ORM directly for application data such as posts or orders. Choose a session adapter only
when connecting `createSessions` to that database; Better Auth uses its own database adapter.

## Shared rules

- Keep clients in `.server.ts` / `app/lib/server/`, reuse one pool per process, and close it in
  your worker lifecycle. Never create a new pool for every request.
- Authorize each data operation and constrain ownership in the query itself.
- Bind values with the ORM/driver's parameter API; never interpolate input into SQL or identifiers.
- Run reviewed migrations as a deployment step. The adapters do not introspect or migrate schemas
  on the public request path.
- Choose a driver appropriate to Bun, Node or the target edge platform. SQLite/local files do not
  become distributed storage just because the framework has an edge target.

## Prisma

Use a model with hashed session ID, serialized data and DateTime expiry:

```text
model OptzSession {
  id        String   @id
  data      String
  expiresAt DateTime
  @@index([expiresAt])
}
```

```ts
import { createSessions } from "optz/sessions";
import { prismaSessionStore } from "@sxnistxr/optz-db";
import { prisma } from "./database.server";

export const sessions = createSessions<{ userId: string }>({
  store: prismaSessionStore(prisma.optzSession),
});
```

The adapter calls native `findUnique`, `upsert` and `deleteMany`. Prisma owns driver setup,
connection management and migrations. Expiry is converted between DateTime and Unix milliseconds.

## Drizzle

Pass native typed operations so your table and dialect stay inferred in the app:

```ts
import { eq } from "drizzle-orm";
import { drizzleSessionStore } from "@sxnistxr/optz-db";
import { db, sessions } from "./database.server";

const store = drizzleSessionStore<{ userId: string }>({
  find: async id => (await db.select().from(sessions)
    .where(eq(sessions.id, id)).limit(1))[0],
  upsert: async row => db.insert(sessions).values(row)
    .onConflictDoUpdate({ target: sessions.id, set: row }),
  remove: async id => db.delete(sessions).where(eq(sessions.id, id)),
});
```

This example uses PostgreSQL/SQLite conflict syntax; MySQL uses its native duplicate-key update.
The table has `id` (string primary key), `data` (text), `expiresAt` (milliseconds as a number).
Use Drizzle's native migration tool. No Drizzle dependency is added to apps that do not use it.

## Kysely and TypeORM

The `sqlSessionStore(execute, dialect)` adapter uses constant SQL plus bound values. Its executor
receives a query and parameters separately and returns rows. Supported dialects are PostgreSQL,
MySQL and SQLite. `sessionTableSql` exports the small explicit schema for your migration system;
it is never automatically executed.

```ts
// Kysely: db is an existing Kysely client and dialect/driver configured by the app.
import { CompiledQuery } from "kysely";
import { sqlSessionStore } from "@sxnistxr/optz-db";

const store = sqlSessionStore<{ userId: string }>(async (text, parameters) => {
  const result = await db.executeQuery<{ data: string; expires_at: string | number }>(
    CompiledQuery.raw(text, [...parameters]),
  );
  return result.rows;
}, "postgres");
```

```ts
// TypeORM: reuse an initialized DataSource, do not initialize it in each handler.
import { sqlSessionStore } from "@sxnistxr/optz-db";

const store = sqlSessionStore<{ userId: string }>(
  (text, parameters) => dataSource.query(text, [...parameters]),
  "postgres",
);
```

The SQL schema is `optz_sessions(id VARCHAR(64) PRIMARY KEY, data TEXT NOT NULL,
expires_at BIGINT NOT NULL)` with an expiry index. PostgreSQL binds `$1…`; SQLite/MySQL bind `?`.
Drivers that return a `[rows, metadata]` tuple must unwrap it in the executor.

## Session behavior

All adapters implement the existing `SessionStore<T>` contract, accept hash-only 64-character
token keys, cap serialized session data at 64 KiB and preserve millisecond expiry. Login/token
rotation, cookie flags, revocation and expiry checks remain in `createSessions`. Do not store
passwords or a whole user profile in a session. Schedule expiry-row cleanup in your database.

For Bun-native SQLite, use the existing `sqliteSessionStore` from `optz/sqlite` instead of adding
another adapter layer. A `SessionStore` for `createSessions` is not automatically a Better Auth
database adapter: `@sxnistxr/optz-auth` uses Better Auth's own supported ORM adapters.

The local suite executes parameterized SQLite queries and fake native-operation delegates.
Live PostgreSQL/MySQL pools, ORM generators and migrations must be verified in the consuming app.
Primary references: [Prisma CRUD](https://www.prisma.io/docs/orm/prisma-client/queries/crud),
[Drizzle upserts](https://orm.drizzle.team/docs/guides/upsert),
[Kysely](https://kysely.dev/docs/intro), [TypeORM DataSource](https://typeorm.io/docs/data-source/data-source-api/).
