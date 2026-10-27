// Config redirects/rewrites/headers, middleware matchers, revalidation across instances and to
// a CDN, cache(), and createTestApp().
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createApp, middlewareFrom, type App } from "../src/handler";
import type { Manifest, ManifestRoute } from "../src/manifest";
import { compilePattern } from "../src/match";
import { cache, revalidatePath, revalidateTag } from "../src/server-api";
import type { StaticEntry } from "../src/static";
import { createTestApp } from "../src/testing";
import { resolveConfig, type Config, type Middleware, type RevalidationChange } from "../src/types";

const api = (path: string, file: string): ManifestRoute => ({ pattern: path, segments: compilePattern(path), file, kind: "api", render: "dynamic", hasLoader: false, layouts: [], preload: [] });
const manifest = (routes: ManifestRoute[]): Manifest => ({
  version: 3,
  builtAt: Date.now(),
  mode: "islands",
  entry: "/assets/entry.js",
  css: [],
  routes,
  islands: {},
  rootLayouts: [],
  redirects: {},
  slots: [],
  intercepts: [],
  actions: {},
  fonts: [],
  apiStatic: {},
});
const html = (s: string): StaticEntry => ({ body: new TextEncoder().encode(s), type: "text/html; charset=utf-8", etag: '"x"', cache: "no-cache" });
const modules: Record<string, unknown> = {
  "echo.ts": { GET: ({ url }: { url: URL }) => Response.json({ path: url.pathname, q: url.searchParams.get("q") }) },
  "bump.ts": { POST: () => (revalidateTag("posts"), Response.json({ ok: true })) },
  "page.ts": { POST: () => (revalidatePath("/blog", "layout"), Response.json({ ok: true })) },
};
const make = (config: Config, middleware: Middleware[] = [], files = new Map<string, StaticEntry>()) =>
  createApp({
    manifest: manifest([api("/api/echo/[...rest]", "echo.ts"), api("/api/bump", "bump.ts"), api("/api/page", "page.ts")]),
    config: resolveConfig(config),
    files,
    middleware,
    platform: { load: async (f) => modules[f] },
  });
const get = (app: App, path: string, init?: RequestInit) => app.fetch(new Request("http://site.test" + path, init));

describe("config rules", () => {
  test("redirects, rewrites and headers in route syntax", async () => {
    const app = await make({
      redirects: [
        { source: "/old/[slug]", destination: "/api/echo/[slug]", permanent: true },
        { source: "/tmp/[...rest]", destination: "/api/echo/[...rest]" },
      ],
      rewrites: [{ source: "/docs/[...rest]", destination: "/api/echo/docs/[...rest]" }],
      headers: [{ source: "/api/[...rest]", headers: { "Access-Control-Allow-Origin": "*" } }],
    });
    const r1 = await get(app, "/old/a b?q=1");
    expect([r1.status, r1.headers.get("location")]).toEqual([308, "/api/echo/a%20b?q=1"]);
    const r2 = await get(app, "/tmp/x/y");
    expect([r2.status, r2.headers.get("location")]).toEqual([307, "/api/echo/x/y"]);
    const r3 = await get(app, "/docs/guide/intro?q=2");
    expect(await r3.json()).toEqual({ path: "/api/echo/docs/guide/intro", q: "2" });
    expect((await get(app, "/api/echo/z")).headers.get("access-control-allow-origin")).toBe("*");
  });

  test("a middleware matcher limits where it runs", async () => {
    const seen: string[] = [];
    const [mw] = middlewareFrom({ default: (ctx, next) => (seen.push(ctx.url.pathname), next()), matcher: ["/api/echo/[...rest]"] });
    const app = await make({}, [mw]);
    await get(app, "/api/echo/a");
    await get(app, "/api/bump", { method: "POST" });
    expect(seen).toEqual(["/api/echo/a"]);
  });
});

describe("revalidation beyond one process", () => {
  const servers: Array<ReturnType<typeof Bun.serve>> = [];
  afterAll(() => servers.forEach((s) => s.stop(true)));

  test("revalidateTag reaches a peer (signed) and the CDN purge hook; forged requests don't", async () => {
    const purged: RevalidationChange[] = [];
    const secret = "shared-secret-for-tests-0123456789";
    // Instance B: tracks what it was told to drop.
    const b = await make({ revalidation: { secret } });
    const seenByB: string[] = [];
    const bCache = cache(async () => (seenByB.push("load"), Date.now()), { tags: ["posts"] });
    await bCache();
    await bCache();
    expect(seenByB).toEqual(["load"]);
    const bServer = Bun.serve({ port: 0, fetch: (r) => b.fetch(r) });
    servers.push(bServer);
    // Instance A: revalidates and forwards.
    const a = await make({ revalidation: { secret, peers: [`http://127.0.0.1:${bServer.port}`], purge: (c) => void purged.push(c) } });
    expect((await get(a, "/api/bump", { method: "POST" })).status).toBe(200);
    await Bun.sleep(150);
    expect(purged).toEqual([{ paths: [], tags: ["posts"] }]);
    await bCache();
    expect(seenByB).toEqual(["load", "load"]);
    // Unsigned or wrongly signed: refused.
    expect((await fetch(`http://127.0.0.1:${bServer.port}/_optz/revalidate`)).status).toBe(404);
    const bad = await fetch(`http://127.0.0.1:${bServer.port}/_optz/revalidate`, { method: "POST", body: JSON.stringify({ at: Date.now(), change: { paths: [], tags: ["posts"] } }), headers: { "X-Optz-Signature": "0".repeat(64) } });
    expect(bad.status).toBe(403);
  });

  test("layout revalidation reaches the purge hook as a prefix; pages carry CDN tags", async () => {
    const purged: RevalidationChange[] = [];
    const files = new Map([["/blog/index.html", html("<p>blog</p>")], ["/index.html", html("<p>home</p>")]]);
    const app = await make({ server: { cdnMaxAge: 300 }, revalidation: { purge: (c) => void purged.push(c) } }, [], files);
    await get(app, "/api/page", { method: "POST" });
    expect(purged).toEqual([{ paths: [{ path: "/blog", prefix: true }], tags: [] }]);
    expect(files.get("/blog/index.html")!.headers).toMatchObject({ "Cache-Tag": "optz-path:/blog", "Surrogate-Key": "optz-path:/blog" });
    expect(files.get("/index.html")!.headers).toMatchObject({ "Cache-Tag": "optz-path:/" });
  });
});

test("cache(): one call per arguments, shared promise, revalidate and failures not kept", async () => {
  let calls = 0;
  const f = cache(async (n: number) => (calls++, n * 2), { revalidate: 0.05 });
  expect(await Promise.all([f(1), f(1), f(2)])).toEqual([2, 2, 4]);
  expect(calls).toBe(2);
  await Bun.sleep(70);
  await f(1);
  expect(calls).toBe(3);
  let tries = 0;
  const flaky = cache(async () => {
    if (++tries === 1) throw new Error("once");
    return "ok";
  });
  await expect(flaky()).rejects.toThrow("once");
  expect(await flaky()).toBe("ok");
});

describe("createTestApp", () => {
  const root = join(import.meta.dir, "../.tmp", `testapp-${process.pid}`);
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  test("builds an app and serves it in-process", async () => {
    mkdirSync(join(root, "app/routes"), { recursive: true });
    mkdirSync(join(root, "app/api"), { recursive: true });
    writeFileSync(join(root, "app/routes/index.tsx"), "export default function Home() { return <h1>hello {'world'}</h1>; }\n");
    writeFileSync(join(root, "app/api/sum.ts"), 'import { handler, json, type HandlerContext } from "optz";\nexport const POST = handler(async ({ body }: HandlerContext<{}, { a: number; b: number }>) => { const { a, b } = await body(); return json({ sum: a + b }); });\n');
    const app = await createTestApp({ root });
    expect(await app.html("/")).toContain("<h1>hello world</h1>");
    expect(await (await app.post("/api/sum", { a: 2, b: 3 })).json()).toEqual({ sum: 5 });
  }, 30_000);
});
