// Bun-only, opt-in: SQLite is never imported by the framework's static/edge serving path.
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type { SessionStore, Session } from "./sessions";
export { Database } from "bun:sqlite";
export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const created = path !== ":memory:" && !existsSync(path);
  const db = new Database(path, { create: true, strict: true });
  if (created) chmodSync(path, 0o600);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  return db;
}
export function migrate(db: Database, migrations: readonly { id: number; sql: string }[]) {
  if (new Set(migrations.map(m => m.id)).size !== migrations.length || migrations.some(m => !Number.isSafeInteger(m.id) || m.id < 1)) throw new TypeError("Migration IDs must be unique positive integers");
  db.exec("CREATE TABLE IF NOT EXISTS __optz_migrations (id INTEGER PRIMARY KEY, checksum TEXT NOT NULL)");
  db.transaction(() => {
    // Acquire the schema write lock before reading versions, including across Bun workers.
    const known = db.query<{ id: number; checksum: string }, []>("SELECT id,checksum FROM __optz_migrations ORDER BY id").all();
    const checksums = new Map(known.map(m => [m.id, m.checksum]));
    const latest = known.at(-1)?.id ?? 0;
    for (const migration of [...migrations].sort((a, b) => a.id - b.id)) {
      const checksum = createHash("sha256").update(migration.sql).digest("hex");
      if (checksums.has(migration.id)) {
        if (checksums.get(migration.id) !== checksum) throw new Error(`Migration ${migration.id} changed after it was applied`);
      } else {
        if (migration.id < latest) throw new Error("Cannot insert a migration before an applied version");
        db.exec(migration.sql);
        db.query("INSERT INTO __optz_migrations (id,checksum) VALUES (?,?)").run(migration.id, checksum);
      }
    }
  }).immediate();
}
export function sqliteSessionStore<T>(db: Database): SessionStore<T> {
  db.exec("CREATE TABLE IF NOT EXISTS __optz_sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS __optz_sessions_expiry ON __optz_sessions(expires_at)");
  const get = db.query<{ data: string; expires_at: number }, [string]>("SELECT data,expires_at FROM __optz_sessions WHERE id=?");
  const set = db.query("INSERT OR REPLACE INTO __optz_sessions (id,data,expires_at) VALUES (?,?,?)");
  const remove = db.query("DELETE FROM __optz_sessions WHERE id=?");
  const prune = db.query("DELETE FROM __optz_sessions WHERE expires_at<=?");
  return {
    get(key): Session<T> | undefined { const row = get.get(key); return row ? { data: JSON.parse(row.data), expiresAt: row.expires_at } : undefined; },
    set(key, value) { prune.run(Date.now()); set.run(key, JSON.stringify(value.data), value.expiresAt); },
    delete(key) { remove.run(key); },
  };
}
