import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { createStatusHandler, overallStatus } from "../src/index";
import { sqliteStatusStore } from "../src/sqlite";
import { StatusPage } from "../src/view";
test("status mutations require admin plus origin, store a timeline and hide audit identities", async () => {
  const db = new Database(":memory:"), store = sqliteStatusStore(db);
  const handle = createStatusHandler({ store, origin: "https://app.test", authorizeAdmin: async r => r.headers.get("cookie") === "admin=1" ? { id: "PRIVATE_ACTOR" } : null });
  const post = (path: string, value: unknown, admin = true, origin = "https://app.test") => handle(new Request("https://app.test/api/status" + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(admin ? { Cookie: "admin=1" } : {}) }, body: JSON.stringify(value) }));
  try {
    expect((await post("/components", { id: "api", name: "API", status: "outage" }, false)).status).toBe(403);
    expect((await post("/components", { id: "api", name: "API", status: "outage" }, true, "https://evil.test")).status).toBe(403);
    expect((await post("/components", { id: "api", name: "API", status: "outage" })).status).toBe(200);
    expect((await post("/components", { id: "db", name: "DB", status: "made-up" })).status).toBe(422);
    const created = await (await post("/incidents", { title: "<script>alert(1)</script>", status: "investigating", message: "Investigating latency" })).json();
    expect((await post(`/incidents/${created.id}`, { status: "resolved", message: "Recovered" })).status).toBe(200);
    const publicResponse = await handle(new Request("https://app.test/api/status"));
    const text = await publicResponse.text(); expect(text).not.toContain("PRIVATE_ACTOR");
    const snapshot = JSON.parse(text); expect(snapshot.incidents[0].updates.length).toBe(2); expect(snapshot.incidents[0].status).toBe("resolved");
    expect(overallStatus(snapshot.components)).toBe("outage");
    const html = renderToStaticMarkup(createElement(StatusPage, { snapshot })); expect(html).toContain("&lt;script&gt;"); expect(html).not.toContain("<script>");
    expect(db.query<{ n: number }, []>("SELECT count(*) n FROM optz_status_audit").get()!.n).toBe(1);
  } finally { db.close(); }
});
test("public status budget is bounded without trusting forwarded identity headers", async () => {
  const db = new Database(":memory:"), handle = createStatusHandler({ store: sqliteStatusStore(db), origin: "https://app.test", publicRequestsPerMinute: 1, authorizeAdmin: async () => null });
  try { expect((await handle(new Request("https://app.test/api/status"))).status).toBe(200); expect((await handle(new Request("https://app.test/api/status", { headers: { "X-Forwarded-For": "other" } }))).status).toBe(429); } finally { db.close(); }
});
