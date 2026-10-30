import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createSessions } from "optz/sessions";
import { sqlSessionStore, sessionTableSql, prismaSessionStore, drizzleSessionStore } from "../src/index";
test("SQL session adapters bind values, rotate identities and persist safely", async () => {
  const db = new Database(":memory:"); db.exec(sessionTableSql);
  const queries: { text: string; values: readonly (string | number)[] }[] = [];
  const store = sqlSessionStore<{ user: string }>(async (text, values) => { queries.push({ text, values }); if (text.startsWith("SELECT")) return db.query(text).all(...values) as { data: string; expires_at: number }[]; db.query(text).run(...values); return []; }, "sqlite");
  try {
    const manager = createSessions({ store }), value = "x'); DROP TABLE optz_sessions;--";
    const cookie = await manager.create({ user: value });
    const request = new Request("https://app.test", { headers: { Cookie: cookie.split(";")[0] } });
    expect((await manager.read(request))?.data.user).toBe(value);
    expect(queries.every(q => !q.text.includes(value))).toBe(true); expect(queries.some(q => JSON.stringify(q.values).includes("DROP TABLE"))).toBe(true);
    const fresh = await manager.create({ user: "new" }, request); expect(await manager.read(request)).toBeUndefined(); expect(fresh).not.toBe(cookie);
    const before = queries.length; expect(await store.get("not-a-hashed-token")).toBeUndefined(); expect(queries.length).toBe(before);
    await expect(Promise.resolve().then(() => store.set("invalid", { data: { user: "x" }, expiresAt: Date.now() }))).rejects.toThrow();
  } finally { db.close(); }
});
test("Prisma and Drizzle adapters preserve native operation boundaries and expiry units", async () => {
  const rows = new Map<string, { id: string; data: string; expiresAt: Date }>();
  const prisma = prismaSessionStore<{ id: number }>({
    async findUnique({ where }) { return rows.get(where.id) ?? null; },
    async upsert({ create }) { rows.set(create.id, create); },
    async deleteMany({ where }) { rows.delete(where.id); },
  });
  const key = "a".repeat(64), session = { data: { id: 7 }, expiresAt: Date.now() + 5000 };
  await prisma.set(key, session); expect(await prisma.get(key)).toEqual(session); await prisma.delete(key); expect(await prisma.get(key)).toBeUndefined();
  const records = new Map<string, { id: string; data: string; expiresAt: number }>();
  const drizzle = drizzleSessionStore<{ id: number }>({ async find(key) { return records.get(key); }, async upsert(value) { records.set(value.id, value); }, async remove(key) { records.delete(key); } });
  await drizzle.set(key, session); expect(await drizzle.get(key)).toEqual(session); await drizzle.delete(key); expect(await drizzle.get(key)).toBeUndefined();
});
