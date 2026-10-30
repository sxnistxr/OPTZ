import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createUploads, createUploadHandler, type ObjectProvider, type StoredPart } from "../src/index";
import { sqliteUploadStore } from "../src/sqlite";
import { createS3Provider } from "../src/s3";
const fixture = (inspect?: Parameters<typeof createUploads>[0]["inspect"]) => {
  const db = new Database(":memory:"), store = sqliteUploadStore(db, { bytesPerOwner: 24 * 1024 ** 2, pendingPerOwner: 2 });
  const objects = new Map<string, { size: number; type: string }>(), parts = new Map<string, StoredPart[]>();
  let promotes = 0, aborts = 0;
  const provider: ObjectProvider = {
    checksums: true,
    async create(r) { parts.set(r.id, []); return "provider-" + r.id; },
    async sign(r, part, checksum) { return { url: `https://objects.test/${r.key}?part=${part ?? 0}`, headers: { "x-amz-checksum-sha256": checksum! } }; },
    async parts(r) { return parts.get(r.id) ?? []; },
    async complete(r) { objects.set(r.key, { size: r.size, type: r.type }); },
    async abort(r) { aborts++; parts.delete(r.id); },
    async head(key) { return objects.get(key); },
    async promote(r) { promotes++; objects.set(r.finalKey, { ...objects.get(r.key)! }); },
    async remove(key) { objects.delete(key); },
    async download(r) { return { url: "https://objects.test/" + r.finalKey }; },
  };
  const uploads = createUploads({ store, provider, types: ["text/plain"], multipartThreshold: 5 * 1024 ** 2, partSize: 5 * 1024 ** 2, inspect });
  return { db, store, uploads, objects, parts, provider, get promotes() { return promotes; }, get aborts() { return aborts; } };
};
const checksum = "a".repeat(43) + "=";
test("single upload ownership, signed checksum, immutable promotion, download and quota release", async () => {
  const f = fixture();
  try {
    const plan = await f.uploads.initiate("alice", { name: "file.txt", size: 5, type: "text/plain" });
    await expect(f.uploads.sign("bob", plan.id, undefined, checksum)).rejects.toHaveProperty("status", 404);
    await expect(f.uploads.sign("alice", plan.id)).rejects.toHaveProperty("status", 422);
    await f.uploads.sign("alice", plan.id, undefined, checksum);
    const r = (await f.store.get(plan.id))!; f.objects.set(r.key, { size: 5, type: "text/plain" });
    const complete = await f.uploads.complete("alice", plan.id); expect(complete.key).toStartWith("objects/"); expect(f.promotes).toBe(1); expect(f.objects.has(r.key)).toBe(false);
    f.objects.set(r.key, { size: 999, type: "text/html" }); // replaying an old staging URL cannot alter approved bytes
    expect(f.objects.get(complete.key)!.size).toBe(5);
    expect(await f.uploads.complete("alice", plan.id)).toEqual(complete); expect(f.promotes).toBe(1);
    await expect(f.uploads.download("bob", plan.id)).rejects.toHaveProperty("status", 404);
    expect((await f.uploads.download("alice", plan.id)).url).toContain(complete.key);
    await f.uploads.remove("alice", plan.id); expect((await f.store.get(plan.id))!.state).toBe("aborted"); expect(f.objects.has(complete.key)).toBe(false);
  } finally { f.db.close(); }
});
test("multipart completion uses provider-authoritative sizes and checksums, never caller ETags", async () => {
  const f = fixture();
  try {
    const size = 6 * 1024 ** 2, plan = await f.uploads.initiate("alice", { name: "large.txt", size, type: "text/plain" });
    expect(plan.multipart).toBe(true);
    await expect(f.uploads.sign("alice", plan.id, 3, checksum)).rejects.toHaveProperty("status", 422);
    f.parts.set(plan.id, [{ number: 1, size: 5 * 1024 ** 2, etag: "part-a", checksum }]);
    await expect(f.uploads.complete("alice", plan.id)).rejects.toHaveProperty("status", 422);
    f.parts.get(plan.id)!.push({ number: 2, size: 1024 ** 2, etag: "part-b", checksum });
    const completed = await f.uploads.complete("alice", plan.id); expect(completed.size).toBe(size);
  } finally { f.db.close(); }
});
test("quota reservations are atomic, scanning targets immutable keys and rejection stays private", async () => {
  let scannedKey = "";
  const f = fixture(async r => { scannedKey = r.key; throw new Error("scanner-private-details"); });
  try {
    const first = await f.uploads.initiate("alice", { name: "a", size: 13 * 1024 ** 2, type: "text/plain" });
    await expect(f.uploads.initiate("alice", { name: "b", size: 13 * 1024 ** 2, type: "text/plain" })).rejects.toHaveProperty("status", 409);
    await f.uploads.abort("alice", first.id); expect(f.aborts).toBe(1);
    await expect(f.uploads.initiate("alice", { name: "replay-budget", size: 13 * 1024 ** 2, type: "text/plain" })).rejects.toHaveProperty("status", 409);
    f.db.query("UPDATE optz_uploads SET expires_at=? WHERE id=?").run(Date.now() - 1, first.id);
    await f.uploads.cleanup(); expect(await f.store.get(first.id)).toBeUndefined();
    const plan = await f.uploads.initiate("alice", { name: "new", size: 5, type: "text/plain" });
    const r = (await f.store.get(plan.id))!; f.objects.set(r.key, { size: 5, type: "text/plain" });
    await expect(f.uploads.complete("alice", plan.id)).rejects.toThrow(); expect(scannedKey).toBe(r.finalKey); expect(f.objects.has(r.finalKey)).toBe(false); expect((await f.store.get(plan.id))!.state).toBe("active");
    await expect(f.uploads.download("alice", plan.id)).rejects.toHaveProperty("status", 409);
  } finally { f.db.close(); }
});
test("control endpoints authenticate, enforce CSRF and bound input without exposing provider errors", async () => {
  const f = fixture(), handle = createUploadHandler({ uploads: f.uploads, origin: "https://app.test", authorize: async r => r.headers.get("cookie") === "user=alice" ? { id: "alice" } : null });
  const request = (cookie = "user=alice", origin = "https://app.test") => new Request("https://app.test/api/uploads/initiate", { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ name: "x", type: "text/plain", size: 5 }) });
  try { expect((await handle(request(""))).status).toBe(401); expect((await handle(request("user=alice", "https://evil.test"))).status).toBe(403); expect((await handle(request())).status).toBe(200); } finally { f.db.close(); }
});
test("S3 presigning binds bytes and content headers and keeps credentials out of response headers", async () => {
  const provider = createS3Provider({ bucket: "test-bucket", client: { region: "us-east-1", credentials: { accessKeyId: "FIXTURE_ACCESS", secretAccessKey: "FIXTURE_SECRET" } } });
  const record = { id: crypto.randomUUID(), owner: "alice", key: "pending/test", finalKey: "objects/final", name: "file.txt", type: "text/plain", size: 5, partSize: 5 * 1024 ** 2, state: "active" as const, expiresAt: Date.now() + 60000 };
  const signed = await provider.sign(record, undefined, checksum), url = new URL(signed.url);
  expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length"); expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
  expect(signed.headers["x-amz-checksum-sha256"]).toBe(checksum); expect(JSON.stringify(signed)).not.toContain("FIXTURE_SECRET");
  expect(() => createS3Provider({ bucket: "test-bucket", client: { endpoint: "http://internal.test", region: "auto" } })).toThrow();
});
