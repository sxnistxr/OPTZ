import { expect, test } from "bun:test";
import { cloudflarePurge, purgeCloudflare } from "../src/cdn";
const options = { zoneId: "a".repeat(32), token: "SECRET_FIXTURE" };
test("Cloudflare batches, soft invalidation and API-level failure checks", async () => {
  const original = globalThis.fetch, calls: { url: string; body: Record<string, string[]> }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => { calls.push({ url: String(url), body: JSON.parse(init!.body as string) }); return Response.json({ success: true }); }) as unknown as typeof fetch;
  try {
    expect(await purgeCloudflare({ ...options, mode: "invalidate" }, { tags: Array.from({ length: 205 }, (_, i) => `tag-${i}`) })).toEqual({ acceptedBatches: 3 });
    expect(calls[0].url).toEndWith("/invalidate_cache"); expect(calls.map(c => c.body.tags.length)).toEqual([100, 100, 5]);
    globalThis.fetch = (async () => Response.json({ success: false, errors: [{ message: "SECRET_FIXTURE" }] })) as unknown as typeof fetch;
    await expect(purgeCloudflare(options, { tags: ["a"] })).rejects.toThrow("did not accept");
    globalThis.fetch = (async () => new Response("SECRET_FIXTURE", { status: 429 })) as unknown as typeof fetch;
    await expect(purgeCloudflare(options, { tags: ["a"] })).rejects.toThrow("HTTP 429");
  } finally { globalThis.fetch = original; }
});
test("CDN targets cannot escape the configured origin or silently purge unrelated content", async () => {
  const original = globalThis.fetch; let calls = 0; const failures: Error[] = [];
  globalThis.fetch = (async () => { calls++; return Response.json({ success: true }); }) as unknown as typeof fetch;
  try {
    const hook = cloudflarePurge({ ...options, byTag: false, onError: e => failures.push(e) });
    await hook({ paths: [{ path: "//evil.test/private", prefix: false }], tags: [] }, "https://app.test");
    expect(calls).toBe(0); expect(failures.length).toBe(1);
    await expect(purgeCloudflare(options, { files: ["https://user:password@app.test/"] })).rejects.toThrow();
    await expect(purgeCloudflare(options, { tags: ["one"], purge_everything: true } as never)).rejects.toThrow("exactly one");
    await hook({ paths: [], tags: ["private"] }, "https://app.test"); expect(calls).toBe(0);
  } finally { globalThis.fetch = original; }
});
