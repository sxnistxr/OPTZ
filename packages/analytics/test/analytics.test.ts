import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createAnalytics, type AnalyticsEvent } from "../src/index";
import { sqliteAnalyticsStore } from "../src/sqlite";
import { posthogAdapter } from "../src/posthog";
const settings = { secret: "local-test-only-secret-32-characters-long", origin: "https://app.test", events: { viewed: { plan: ["free", "paid"] }, signed_up: {}, purchased: {} } } as const;
test("consent, origin and property allowlists precede storage; IDs are keyed hashes", async () => {
  const db = new Database(":memory:"), store = sqliteAnalyticsStore(db);
  const outgoing: unknown[] = [];
  const analytics = createAnalytics({ ...settings, store, adapters: [posthogAdapter({ capture: event => outgoing.push(event) })] });
  const request = (body: unknown, headers: Record<string, string> = {}) => new Request("https://app.test/api/events?token=DO_NOT_CAPTURE", { method: "POST", headers: { Origin: settings.origin, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  try {
    expect((await analytics.ingest(request({ event: "viewed", subject: "opaque-user-id" }))).status).toBe(422);
    expect((await analytics.ingest(request({ consent: true, event: "viewed", subject: "opaque-user-id" }, { Origin: "https://evil.test" }))).status).toBe(403);
    expect((await analytics.ingest(request({ consent: true, event: "viewed", subject: "opaque-user-id", properties: { email: "private@example.test" } }))).status).toBe(422);
    expect((await analytics.ingest(request({ consent: true, event: "viewed", subject: "opaque-user-id" }, { DNT: "1" }))).status).toBe(204);
    expect((await store.scan(0, Date.now() + 1)).length).toBe(0);
    expect((await analytics.ingest(request({ consent: true, event: "viewed", subject: "opaque-user-id", properties: { plan: "paid" } }))).status).toBe(204);
    const rows = await analytics.exportSubject("opaque-user-id"); expect(rows.length).toBe(1); expect(rows[0].subject).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(rows)).not.toContain("opaque-user-id"); expect(JSON.stringify(rows)).not.toContain("DO_NOT_CAPTURE");
    expect(JSON.stringify(outgoing)).not.toContain("opaque-user-id"); expect(JSON.stringify(outgoing)).toContain("$process_person_profile");
    await analytics.deleteSubject("opaque-user-id"); expect((await analytics.exportSubject("opaque-user-id")).length).toBe(0);
  } finally { db.close(); }
});
test("trends, ordered distinct-subject funnels and retention cohorts have defined counts", async () => {
  const db = new Database(":memory:"), store = sqliteAnalyticsStore(db), a = createAnalytics({ ...settings, store });
  const rows: AnalyticsEvent[] = [
    { event: "viewed", subject: "a", at: 100, properties: {} }, { event: "signed_up", subject: "a", at: 200, properties: {} }, { event: "purchased", subject: "a", at: 300, properties: {} },
    { event: "purchased", subject: "b", at: 100, properties: {} }, { event: "viewed", subject: "b", at: 200, properties: {} }, { event: "signed_up", subject: "b", at: 400, properties: {} },
    { event: "viewed", subject: "a", at: 86500100, properties: {} },
  ];
  try {
    rows.forEach(r => store.append(r));
    expect(await a.funnel(["viewed", "signed_up", "purchased"], 0, 90000000)).toEqual([{ event: "viewed", subjects: 2 }, { event: "signed_up", subjects: 2 }, { event: "purchased", subjects: 1 }]);
    expect(await a.trends("viewed", 0, 90000000)).toEqual([{ at: 0, count: 2 }, { at: 86400000, count: 1 }]);
    expect(await a.retention("viewed", "viewed", 0, 90000000, 86400000, 2)).toEqual([{ at: 0, subjects: 2, returned: [2, 1] }]);
    await expect(a.funnel(["viewed"], 0, 100)).rejects.toThrow();
    await expect(a.trends("viewed", 100, 0)).rejects.toThrow();
  } finally { db.close(); }
});
test("event capacity is atomic, pruning releases capacity, and adapter errors cannot drop local data", async () => {
  const db = new Database(":memory:"), store = sqliteAnalyticsStore(db, 1), a = createAnalytics({ ...settings, store, adapters: [{ capture() { throw new Error("provider-private-error"); } }] });
  try {
    await a.capture("viewed", "opaque-user-id"); await expect(a.capture("viewed", "other-user-id")).rejects.toThrow("capacity");
    expect((await a.exportSubject("opaque-user-id")).length).toBe(1);
    store.prune(Date.now() + 1); await a.capture("viewed", "other-user-id"); expect((await a.exportSubject("other-user-id")).length).toBe(1);
  } finally { db.close(); }
});
