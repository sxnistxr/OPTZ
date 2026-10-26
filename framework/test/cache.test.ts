import { expect, test } from "bun:test";
import { ResponseCache } from "../src/cache";
import { bunPlatform } from "../src/server";
import { resolveConfig } from "../src/types";

const z = bunPlatform("/tmp", resolveConfig({}));

const req = (h: Record<string, string> = {}) => new Request("http://x/a", { headers: h });
const url = new URL("http://x/a");
const body = (n: number) => new Response(JSON.stringify({ n, pad: "x".repeat(600) }), { headers: { "Content-Type": "application/json" } });

test("serves fresh entries from memory, compressed, with ETag and 304", async () => {
  const c = new ResponseCache(10, 1 << 20, z);
  let calls = 0;
  const produce = async () => body(++calls);
  const rc = { maxAge: 60 };
  const r1 = await c.handle(req(), "k", rc, produce);
  const r2 = await c.handle(req({ "accept-encoding": "br" }), "k", rc, produce);
  expect(calls).toBe(1);
  expect((await r1.json()).n).toBe(1);
  expect(r2.headers.get("content-encoding")).toBe("br");
  expect(r2.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=60");
  const r3 = await c.handle(req({ "if-none-match": r1.headers.get("etag")! }), "k", rc, produce);
  expect(r3.status).toBe(304);
  expect(c.stats.hits).toBe(2);
});

test("concurrent misses share one render", async () => {
  const c = new ResponseCache(10, 1 << 20, z);
  let calls = 0;
  const produce = async () => {
    calls++;
    await Bun.sleep(20);
    return body(calls);
  };
  const rs = await Promise.all(Array.from({ length: 50 }, () => c.handle(req(), "k", { maxAge: 60 }, produce)));
  expect(calls).toBe(1);
  expect(rs.every((r) => r.status === 200)).toBe(true);
});

test("stale-while-revalidate: serves stale once, refreshes in the background", async () => {
  const c = new ResponseCache(10, 1 << 20, z);
  let calls = 0;
  const produce = async () => body(++calls);
  const rc = { maxAge: 0.05, staleWhileRevalidate: 60 };
  await c.handle(req(), "k", rc, produce);
  await Bun.sleep(80);
  const stale = await c.handle(req(), "k", rc, produce);
  expect((await stale.json()).n).toBe(1);
  await Bun.sleep(20);
  const fresh = await c.handle(req(), "k", rc, produce);
  expect((await fresh.json()).n).toBe(2);
  expect(calls).toBe(2);
});

test("never stores errors, cookies or no-store responses", async () => {
  const c = new ResponseCache(10, 1 << 20, z);
  let calls = 0;
  for (const make of [
    () => new Response("x", { status: 500 }),
    () => new Response("x", { headers: { "Set-Cookie": "a=1" } }),
    () => new Response("x", { headers: { "Cache-Control": "no-store" } }),
  ]) {
    await c.handle(req(), "k", { maxAge: 60 }, async () => (calls++, make()));
    await c.handle(req(), "k", { maxAge: 60 }, async () => (calls++, make()));
  }
  expect(calls).toBe(6);
});

test("evicts least recently used past the entry limit", async () => {
  const c = new ResponseCache(2, 1 << 20, z);
  const rc = { maxAge: 60 };
  for (const k of ["a", "b", "c"]) await c.handle(req(), k, rc, async () => body(1));
  expect(c.stats.entries).toBe(2);
  let produced = false;
  await c.handle(req(), "a", rc, async () => ((produced = true), body(2)));
  expect(produced).toBe(true);
});

test("vary headers split the key", () => {
  const rc = { maxAge: 1, vary: ["accept-language"] };
  expect(ResponseCache.key(req({ "accept-language": "en" }), url, rc)).not.toBe(ResponseCache.key(req({ "accept-language": "de" }), url, rc));
});
