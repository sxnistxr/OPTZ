import { join } from "node:path";
import { openDatabase, migrate, sqliteSessionStore } from "optz/sqlite";
import { createSessions } from "optz/sessions";
import { localStorage } from "optz/storage";
import { createRateLimiter } from "optz/security";

export const origin = new URL(process.env.PUBLIC_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3007}`).origin;
export interface User { id: string; email: string }
export interface Note { id: string; text: string; done: number }
export interface Attachment { key: string; name: string; size: number }
function initialize() {
  const root = join(import.meta.dir, "../..");
  const maxUsers = Number(process.env.MAX_USERS ?? 100), maxStorageBytes = Number(process.env.MAX_STORAGE_BYTES ?? (100 << 20));
  if (![maxUsers, maxStorageBytes].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error("Invalid app capacity configuration");
  const db = openDatabase(process.env.DATABASE_PATH ?? join(root, ".data/app.sqlite"));
  migrate(db, [{ id: 1, sql: `
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL);
    CREATE TABLE notes (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX notes_owner ON notes(user_id);
    CREATE TABLE files (key TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, size INTEGER NOT NULL);
    CREATE INDEX files_owner ON files(user_id);
  ` }]);
  const sessions = createSessions<User>({ store: sqliteSessionStore(db), secure: origin.startsWith("https:") });
  const files = localStorage(process.env.UPLOAD_DIR ?? join(root, ".data/uploads"));
  return { db, sessions, files, maxUsers, maxStorageBytes, limiter: createRateLimiter({ limit: 60, windowMs: 60000 }), authWork: 0, uploads: 0, streams: 0 };
}
let state: ReturnType<typeof initialize> | undefined;
export const app = () => state ??= initialize();
/** Every data operation authenticates here, then constrains SQL by the authenticated owner. */
export async function requireUser(request: Request): Promise<User> {
  const session = await app().sessions.read(request);
  if (!session) throw new Response(null, { status: 303, headers: { Location: "/login", "Cache-Control": "private, no-store" } });
  return session.data;
}
export function limited(key: string) {
  const result = app().limiter.consume(key);
  if (!result.allowed) throw new Response("Try again shortly", { status: 429, headers: { "Retry-After": String(result.retryAfter), "Cache-Control": "no-store" } });
}
