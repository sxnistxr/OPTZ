import type { Session, SessionStore } from "optz/sessions";
export type SqlDialect = "postgres" | "mysql" | "sqlite";
export type SqlExecutor = (text: string, parameters: readonly (string | number)[]) => Promise<readonly { data: string; expires_at: string | number | bigint }[]>;
const keyValid = (key: string) => /^[a-f0-9]{64}$/.test(key);
const encode = <T>(session: Session<T>) => {
  if (!Number.isSafeInteger(session.expiresAt) || session.expiresAt < 1) throw new TypeError("Invalid session expiry");
  const text = JSON.stringify(session.data);
  if (typeof text !== "string" || new TextEncoder().encode(text).length > 65536) throw new TypeError("Session data exceeds 64 KiB");
  return text;
};
/** Constant SQL + bound values. Works with Kysely, TypeORM or a native pool; no ORM dependency. */
export function sqlSessionStore<T>(execute: SqlExecutor, dialect: SqlDialect): SessionStore<T> {
  if (!["postgres", "mysql", "sqlite"].includes(dialect)) throw new TypeError("Unknown database dialect");
  const p = (n: number) => dialect === "postgres" ? `$${n}` : "?";
  return {
    async get(key) {
      if (!keyValid(key)) return;
      const [row] = await execute(`SELECT data,expires_at FROM optz_sessions WHERE id=${p(1)}`, [key]);
      if (!row) return;
      const expiresAt = Number(row.expires_at);
      if (!Number.isSafeInteger(expiresAt)) throw new Error("Invalid stored session expiry");
      return { data: JSON.parse(row.data) as T, expiresAt };
    },
    async set(key, value) {
      if (!keyValid(key)) throw new TypeError("Session stores accept hashed token keys only");
      const suffix = dialect === "mysql" ? "ON DUPLICATE KEY UPDATE data=VALUES(data),expires_at=VALUES(expires_at)" : "ON CONFLICT(id) DO UPDATE SET data=excluded.data,expires_at=excluded.expires_at";
      await execute(`INSERT INTO optz_sessions(id,data,expires_at) VALUES (${p(1)},${p(2)},${p(3)}) ${suffix}`, [key, encode(value), value.expiresAt]);
    },
    async delete(key) { if (keyValid(key)) await execute(`DELETE FROM optz_sessions WHERE id=${p(1)}`, [key]); },
  };
}
export interface PrismaSessionDelegate {
  findUnique(args: { where: { id: string } }): Promise<{ data: string; expiresAt: Date } | null>;
  upsert(args: { where: { id: string }; create: { id: string; data: string; expiresAt: Date }; update: { data: string; expiresAt: Date } }): Promise<unknown>;
  deleteMany(args: { where: { id: string } }): Promise<unknown>;
}
/** Pass prisma.optzSession. Prisma owns its client, connection pool and migrations. */
export function prismaSessionStore<T>(model: PrismaSessionDelegate): SessionStore<T> {
  return {
    async get(key) { if (!keyValid(key)) return; const row = await model.findUnique({ where: { id: key } }); return row ? { data: JSON.parse(row.data) as T, expiresAt: row.expiresAt.getTime() } : undefined; },
    async set(key, value) { if (!keyValid(key)) throw new TypeError("Session stores accept hashed token keys only"); const data = { data: encode(value), expiresAt: new Date(value.expiresAt) }; await model.upsert({ where: { id: key }, create: { id: key, ...data }, update: data }); },
    async delete(key) { if (keyValid(key)) await model.deleteMany({ where: { id: key } }); },
  };
}
/** Native Drizzle operations preserve inferred table/dialect types in the application. */
export function drizzleSessionStore<T>(operations: {
  find: (hash: string) => Promise<{ data: string; expiresAt: number } | undefined>;
  upsert: (row: { id: string; data: string; expiresAt: number }) => Promise<unknown>;
  remove: (hash: string) => Promise<unknown>;
}): SessionStore<T> {
  return {
    async get(key) { if (!keyValid(key)) return; const row = await operations.find(key); return row ? { data: JSON.parse(row.data) as T, expiresAt: row.expiresAt } : undefined; },
    async set(key, value) { if (!keyValid(key)) throw new TypeError("Session stores accept hashed token keys only"); await operations.upsert({ id: key, data: encode(value), expiresAt: value.expiresAt }); },
    async delete(key) { if (keyValid(key)) await operations.remove(key); },
  };
}
/** Schema is intentionally explicit; run through the application's migration tool, once. */
export const sessionTableSql = "CREATE TABLE optz_sessions (id VARCHAR(64) PRIMARY KEY, data TEXT NOT NULL, expires_at BIGINT NOT NULL); CREATE INDEX optz_sessions_expiry ON optz_sessions(expires_at);";
