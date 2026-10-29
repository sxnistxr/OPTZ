import { expect, spyOn, test } from "bun:test";
import React from "react";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, brotliDecompressSync, gzipSync, gunzipSync } from "node:zlib";
import { ResponseCache } from "../src/cache";
import { createApp } from "../src/handler";
import { compilePattern } from "../src/match";
import type { Manifest, ManifestRoute } from "../src/manifest";
import { env, headers } from "../src/server-api";
import { send, type StaticEntry } from "../src/static";
import { localStorage } from "../src/storage";
import { resolveConfig } from "../src/types";

const manifest = (routes: ManifestRoute[] = []): Manifest => ({
  version: 3, builtAt: 0, mode: "islands", entry: "/entry.js", css: [], routes,
  islands: {}, rootLayouts: [], redirects: {}, slots: [], intercepts: [], actions: {}, fonts: [], apiStatic: {},
});
const request = (path: string, init?: RequestInit) => new Request("https://site.test" + path, init);
const entry = (body: string, type: string): StaticEntry => ({ body: new TextEncoder().encode(body), type, etag: '"old"', cache: "no-cache" });
const pageRoute = (): ManifestRoute => ({
  pattern: "/isr", segments: compilePattern("/isr"), file: "page.tsx", kind: "page", render: "static",
  hasLoader: true, layouts: [], preload: [], revalidate: 60,
});

test("stripped proxy paths cannot replace the target origin or leak credentials", async () => {
  const destinations: URL[] = [];
  const outgoing = spyOn(globalThis, "fetch").mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    destinations.push(new URL(String(input)));
    expect(new Headers(init?.headers).get("cookie")).toBe("session=fixture");
    return new Response("upstream");
  }) as typeof fetch);
  try {
    const app = await createApp({ manifest: manifest(), config: resolveConfig({ proxy: { "/ext": { target: "https://trusted.test", strip: true } } }), files: new Map(), platform: { load: async () => ({}) } });
    for (const path of ["/ext//attacker.test/steal?q=1", "/ext/\\attacker.test/steal", "/ext/%2f%2fattacker.test/steal"]) {
      const response = await app.fetch(request(path, { headers: { Cookie: "session=fixture", Authorization: "Bearer fixture" } }));
      expect(response.status).toBe(200);
    }
    expect(destinations).toHaveLength(3);
    expect(destinations.every(url => url.origin === "https://trusted.test")).toBe(true);
    expect(destinations[0].pathname).toBe("//attacker.test/steal");
    expect(destinations[0].search).toBe("?q=1");
  } finally { outgoing.mockRestore(); }
});

test("revalidation rejects unsigned bodies without consuming them and bounds signed-looking streams", async () => {
  const app = await createApp({ manifest: manifest(), config: resolveConfig({ server: { maxRequestBodySize: 64 }, revalidation: { secret: "audit-test-secret" } }), files: new Map(), platform: { load: async () => ({}) } });
  let reads = 0;
  const unsigned = request("/_optz/revalidate", { method: "POST", body: new ReadableStream({ pull(c) { reads++; c.enqueue(new Uint8Array(1024)); c.close(); } }, { highWaterMark: 0 }) });
  expect((await app.fetch(unsigned)).status).toBe(403);
  expect(reads).toBe(0);
  let cancelled = false;
  const oversized = request("/_optz/revalidate", { method: "POST", headers: { "X-Optz-Signature": "0".repeat(64) }, body: new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(65)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 }) });
  expect((await app.fetch(oversized)).status).toBe(413);
  expect(cancelled).toBe(true);
});

test("bounded revalidation still accepts authentic messages and rejects tampered messages", async () => {
  const secret = "audit-test-secret";
  const app = await createApp({ manifest: manifest(), config: resolveConfig({ server: { maxRequestBodySize: 512 }, revalidation: { secret } }), files: new Map(), platform: { load: async () => ({}) } });
  const body = JSON.stringify({ at: Date.now(), change: { paths: [], tags: ["café"] } });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))), b => b.toString(16).padStart(2, "0")).join("");
  const post = (value: string) => app.fetch(request("/_optz/revalidate", { method: "POST", headers: { "X-Optz-Signature": signature }, body: value }));
  expect((await post(body)).status).toBe(200);
  expect((await post(body + " ")).status).toBe(403);
});

for (const trigger of ["/isr", "/_optz/data/isr.json"]) {
  test(`ISR triggered by ${trigger} publishes matching HTML/data and preserves edge context`, async () => {
    const files = new Map([
      ["/isr/index.html", entry("old page", "text/html")],
      ["/_optz/data/isr.json", entry('{"data":{"n":0}}', "application/json")],
    ]);
    let calls = 0;
    const bindings: unknown[] = [], cookies: unknown[] = [];
    const tasks: Promise<unknown>[] = [];
    const app = await createApp({ manifest: manifest([pageRoute()]), config: resolveConfig({ lang: "en" }), files, platform: { load: async () => ({
      loader: () => { bindings.push(env<{ BINDING: string }>().BINDING); cookies.push(headers().get("cookie")); return { n: ++calls }; },
      head: (data: { n: number }) => ({ title: `render ${data.n}` }),
      default: ({ data }: { data: { n: number } }) => React.createElement("p", null, `render ${data.n}`),
    }) } });
    const stale = await app.fetch(request(trigger, { headers: { Cookie: "private=visitor" } }), { env: { BINDING: "available" }, waitUntil: task => tasks.push(task) });
    expect(await stale.text()).toBe(trigger === "/isr" ? "old page" : '{"data":{"n":0}}');
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    expect(calls).toBe(1);
    expect(bindings).toEqual(["available"]);
    expect(cookies).toEqual([null]);
    const fresh = await (await app.fetch(request("/_optz/data/isr.json"))).json();
    expect(fresh.data.n).toBe(1);
    expect(fresh.headHtml).toContain("render 1");
    expect(fresh.lang).toBe("en");
    expect(await (await app.fetch(request("/isr"))).text()).toContain("render 1");
    expect(calls).toBe(1);
  });
}

test("cache coalesces until a streaming body finishes and retries after body failure", async () => {
  const cache = new ResponseCache(10, 1 << 20);
  let calls = 0, release!: () => void, reading!: () => void;
  const ready = new Promise<void>(resolve => { reading = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const produce = async () => {
    calls++;
    return new Response(new ReadableStream({ async pull(c) { reading(); await gate; c.enqueue(new TextEncoder().encode("complete")); c.close(); } }, { highWaterMark: 0 }));
  };
  const first = cache.handle(request("/slow"), "slow", { maxAge: 60 }, produce);
  await ready;
  const second = cache.handle(request("/slow"), "slow", { maxAge: 60 }, produce);
  const concurrentCalls = calls;
  release();
  const responses = await Promise.all([first, second]);
  expect(concurrentCalls).toBe(1);
  expect(await Promise.all(responses.map(r => r.text()))).toEqual(["complete", "complete"]);
  await expect(cache.handle(request("/broken"), "broken", { maxAge: 60 }, async () => new Response(new ReadableStream({ start(c) { c.error(new Error("broken body")); } })))).rejects.toThrow("broken body");
  expect(await (await cache.handle(request("/broken"), "broken", { maxAge: 60 }, async () => new Response("retry"))).text()).toBe("retry");
});

test("private attachments preserve complete Unicode characters in long download names", async () => {
  const root = mkdtempSync(join(tmpdir(), "optz-unicode-"));
  try {
    const storage = localStorage(root);
    const name = "a".repeat(254) + "😀extra";
    const saved = await storage.save(new File(["private attachment"], name));
    expect(saved.name).toBe("a".repeat(254) + "😀");
    for (const downloadName of [saved.name, name, "broken\ud800name"]) {
      const response = await storage.response(saved.key, downloadName);
      expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''");
      expect(await response.text()).toBe("private attachment");
    }
    const response = await storage.response(saved.key, saved.name);
    expect(response.headers.get("content-disposition")).toContain("%F0%9F%98%80");
    await response.body!.cancel();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const encodingCases: [string, string | null, number][] = [
  ["br;q=0, gzip;q=0, identity;q=1", null, 200],
  ["br;q=0.2, gzip;q=0.8", "gzip", 200],
  ["br;q=0.8, gzip;q=0.2", "br", 200],
  ["identity;q=1, br;q=0.5, gzip;q=0.2", null, 200],
  ["*;q=0.5, br;q=0", "gzip", 200],
  ["*;q=0, identity;q=1", null, 200],
  ["BR;Q=1, gzip;q=0", "br", 200],
  ["br;q=0, gzip;q=0, identity;q=0", null, 406],
  ["*;q=0", null, 406],
];
test.each(encodingCases)("static and cached responses negotiate %s", async (header, coding, status) => {
  const text = "payload ".repeat(100);
  const bytes = new TextEncoder().encode(text);
  const z = { brotli: (b: Uint8Array) => new Uint8Array(brotliCompressSync(b)), gzip: (b: Uint8Array) => new Uint8Array(gzipSync(b)) };
  const file = { ...entry(text, "text/plain"), br: z.brotli(bytes), gz: z.gzip(bytes) };
  const req = request("/encoding", { headers: { "Accept-Encoding": header } });
  const cache = new ResponseCache(10, 1 << 20, z);
  const responses = [send(file, req), await cache.handle(req, "encoding", { maxAge: 60 }, async () => new Response(text, { headers: { "Content-Type": "text/plain" } }))];
  for (const response of responses) {
    expect(response.status).toBe(status);
    expect(response.headers.get("content-encoding")).toBe(coding);
    if (status === 200) {
      const body = new Uint8Array(await response.arrayBuffer());
      expect(new TextDecoder().decode(coding === "br" ? brotliDecompressSync(body) : coding === "gzip" ? gunzipSync(body) : body)).toBe(text);
    }
  }
});

test("dynamic HTML honors gzip rejection and explicit identity preferences", async () => {
  const route = { ...pageRoute(), render: "dynamic" as const };
  const app = await createApp({ manifest: manifest([route]), config: resolveConfig({ features: { dynamic: true, dynamicCompression: true, streaming: false } }), files: new Map(), platform: {
    gzip: bytes => new Uint8Array(gzipSync(bytes)),
    load: async () => ({ loader: () => ({}), default: () => React.createElement("p", null, "content ".repeat(300)) }),
  } });
  for (const header of ["gzip;q=0", "identity;q=1, gzip;q=0.1"]) {
    const response = await app.fetch(request("/isr", { headers: { "Accept-Encoding": header } }));
    expect(response.status).toBe(200);
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(await response.text()).toContain("content");
  }
});

test("small dynamic HTML is gzipped when identity is refused, and 406 only when nothing is acceptable", async () => {
  const route = { ...pageRoute(), render: "dynamic" as const };
  const app = await createApp({ manifest: manifest([route]), config: resolveConfig({ features: { dynamic: true, dynamicCompression: true, streaming: false } }), files: new Map(), platform: {
    gzip: bytes => new Uint8Array(gzipSync(bytes)),
    load: async () => ({ loader: () => ({}), default: () => React.createElement("p", null, "small") }),
  } });
  const small = await app.fetch(request("/isr", { headers: { "Accept-Encoding": "gzip" } }));
  expect(small.headers.has("content-encoding")).toBe(false);
  const refused = await app.fetch(request("/isr", { headers: { "Accept-Encoding": "gzip, identity;q=0" } }));
  expect([refused.status, refused.headers.get("content-encoding")]).toEqual([200, "gzip"]);
  expect(gunzipSync(new Uint8Array(await refused.arrayBuffer())).toString()).toContain("small");
  expect((await app.fetch(request("/isr", { headers: { "Accept-Encoding": "br, identity;q=0" } }))).status).toBe(406);
});
