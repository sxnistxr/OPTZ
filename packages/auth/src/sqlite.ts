import { Database } from "bun:sqlite";
import { openSync, closeSync, mkdirSync, fchmodSync, constants } from "node:fs";
import { dirname } from "node:path";
import { getMigrations } from "better-auth/db/migration";
import type { BetterAuthOptions } from "better-auth";
import type { RequestBudget } from "./transport";

/** Create before opening so SQLite's database and WAL inherit private permissions. */
export function openAuthDatabase(path: string) {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const fd = openSync(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    try { fchmodSync(fd, 0o600); } finally { closeSync(fd); }
  }
  const db = new Database(path, { create: true, strict: true });
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  return db;
}

/** Explicit deployment step. No schema introspection/DDL runs on the public request path. */
export async function migrateAuth(auth: { options: BetterAuthOptions }, execute = false) {
  const plan = await getMigrations(auth.options);
  if (plan.schemaProblems.length || plan.unsafeChanges.length) throw new Error("Auth migration requires manual schema repair/backfill");
  let sql = plan.toBeCreated.length || plan.toBeAdded.length || plan.toBeAddedIndexes.length ? await plan.compileMigrations() : "";
  const db = auth.options.database;
  // The WebAuthn callback checks the quota for a friendly error. This constraint also closes
  // the concurrent-enrollment race across Bun workers, without extra request-time locks.
  const trigger = db instanceof Database && auth.options.plugins?.some(plugin => plugin.id === "passkey") &&
    !db.query("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='optz_auth_passkey_cap'").get()
    ? `CREATE TRIGGER optz_auth_passkey_cap BEFORE INSERT ON passkey WHEN (SELECT count(*) FROM passkey WHERE userId=NEW.userId)>=10 BEGIN SELECT RAISE(ABORT,'Passkey capacity reached'); END;` : "";
  if (trigger) sql += "\n" + trigger;
  if (execute) await plan.runMigrations();
  if (execute && trigger && db instanceof Database) db.exec(trigger);
  return sql;
}

/** Atomic counters shared by Bun workers on one machine; safe across restarts. */
export function sqliteBudget(db: Database, now = Date.now, maxKeys = 10000): RequestBudget {
  if (!Number.isSafeInteger(maxKeys) || maxKeys < 1) throw new TypeError("Invalid budget capacity");
  db.exec("CREATE TABLE IF NOT EXISTS optz_auth_budget (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS optz_auth_budget_expiry ON optz_auth_budget(expires)");
  const consume = db.query<{ count: number; expires: number }, [string, number, string, number, number, number]>(`INSERT INTO optz_auth_budget(key,count,expires) SELECT ?,1,? WHERE EXISTS(SELECT 1 FROM optz_auth_budget WHERE key=?) OR (SELECT count(*) FROM optz_auth_budget)<? ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<=? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<=? THEN excluded.expires ELSE expires END RETURNING count,expires`);
  const prune = db.query("DELETE FROM optz_auth_budget WHERE expires<=?");
  return { consume(key, limit, windowMs) {
    const time = now();
    prune.run(time);
    const row = consume.get(key, time + windowMs, key, maxKeys, time, time);
    if (!row) return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) };
    return { allowed: row.count <= limit, retryAfter: Math.max(1, Math.ceil((row.expires - time) / 1000)) };
  } };
}
