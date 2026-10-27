// Proxy prefixes, the generated nginx config and the edge worker pieces (audit: C10, X13, E1-E4).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { edgeImages } from "../src/edge";
import { createApp, type App } from "../src/handler";
import type { Manifest } from "../src/manifest";
import { nginxConfig } from "../src/nginx";
import { after } from "../src/server-api";
import type { StaticEntry } from "../src/static";
import { resolveConfig, type Config, type Middleware } from "../src/types";

const manifest: Manifest = {
  version: 3,
  builtAt: Date.now(),
  mode: "islands",
  entry: "/assets/entry.js",
  css: [],
  routes: [
    { pattern: "/api/later", segments: [{ kind: "static", value: "api" }, { kind: "static", value: "later" }], file: "later.ts", kind: "api", render: "dynamic", hasLoader: false, layouts: [], preload: [] },
  ],
  islands: {},
  rootLayouts: [],
  redirects: {},
  slots: [],
  intercepts: [],
  actions: {},
  fonts: [],
  apiStatic: {},
};

let upstream: ReturnType<typeof Bun.serve>;
let seen: { url: string; headers: Record<string, string>; body: string }[] = [];

beforeAll(() => {
  upstream = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/slow")) await Bun.sleep(500);
      seen.push({ url: url.pathname + url.search, headers: Object.fromEntries(req.headers), body: await req.text() });
      return new Response("upstream", { headers: { "X-Upstream": "1" } });
    },
  });
});
afterAll(() => upstream.stop(true));

const app = async (config: Config, middleware: Middleware[] = []): Promise<App> =>
  createApp({
    manifest,
    config: resolveConfig(config),
    files: new Map(),
    middleware,
    platform: { load: async () => ({ GET: () => (after(() => {}), new Response("ok")) }) },
  });

describe("proxy prefixes", () => {
  test("keep the target's path, drop forged forwarding and hop-by-hop headers, run middleware", async () => {
    const mw: Middleware = async (_c, next) => {
      const r = await next();
      r.headers.set("X-Mw", "1");
      return r;
    };
    const a = await app({ proxy: { "/ext": { target: `http://127.0.0.1:${upstream.port}/v1`, strip: true } } }, [mw]);
    seen = [];
    const r = await a.fetch(
      new Request("http://site.example/ext/items?x=1", {
        method: "POST",
        body: "hello",
        headers: { "X-Forwarded-Host": "evil.example", "X-Forwarded-For": "6.6.6.6", Connection: "keep-alive, x-secret", Authorization: "Bearer t" },
      }),
    );
    expect(await r.text()).toBe("upstream");
    expect(r.headers.get("x-mw")).toBe("1");
    expect(r.headers.get("x-upstream")).toBe("1");
    expect(seen[0].url).toBe("/v1/items?x=1");
    expect(seen[0].body).toBe("hello");
    expect(seen[0].headers["x-forwarded-host"]).toBe("site.example");
    expect(seen[0].headers["x-forwarded-for"]).toBeUndefined();
    expect(seen[0].headers.authorization).toBe("Bearer t");
  });

  test("bypassMiddleware skips middleware; slow targets time out with 504; big bodies are 413", async () => {
    let ran = false;
    const mw: Middleware = async (_c, next) => ((ran = true), next());
    const a = await app(
      {
        server: { maxRequestBodySize: 8 },
        proxy: { "/fast": { target: `http://127.0.0.1:${upstream.port}`, bypassMiddleware: true, timeoutMs: 100 } },
      },
      [mw],
    );
    expect((await a.fetch(new Request("http://site.example/fast/x"))).status).toBe(200);
    expect(ran).toBe(false);
    expect((await a.fetch(new Request("http://site.example/fast/slow"))).status).toBe(504);
    expect((await a.fetch(new Request("http://site.example/fast/x", { method: "POST", body: "too long for eight" }))).status).toBe(413);
  });
});

describe("nginx", () => {
  const cfg = (c: Config) => resolveConfig(c);
  test("proxies keep protocol, path, Host and body limits; forwarding headers are set, not passed on", () => {
    const out = nginxConfig(cfg({ site: { url: "https://shop.example" }, proxy: { "/api/x": { target: "https://api.example/v2", strip: true, maxBodySize: 65536, bypassMiddleware: true } } }), { distDir: "/srv/dist" });
    expect(out).toContain("proxy_pass https://optz_api_x/v2/;");
    expect(out).toContain("server api.example:443;");
    expect(out).toContain("proxy_set_header Host api.example;");
    expect(out).toContain("client_max_body_size 64k;");
    expect(out).toContain("proxy_ssl_server_name on;");
    expect(out).not.toContain("$proxy_add_x_forwarded_for");
    expect(out).toContain("proxy_set_header X-Forwarded-Host $host;");
    // Only the site's name reaches the app.
    expect(out).toContain("server_name shop.example;");
    expect(out).toContain("return 444;");
  });

  test("a proxy that must run middleware goes through Bun", () => {
    const out = nginxConfig(cfg({ proxy: { "/api/x": { target: "http://127.0.0.1:9000" } } }), { distDir: "/srv/dist", hasMiddleware: true });
    expect(out).not.toContain("location /api/x/");
  });
});

describe("edge", () => {
  const file = (type: string): StaticEntry => ({ body: new Uint8Array([1, 2, 3]), type, etag: '"e"', cache: "public, max-age=3600" });
  const files = new Map([["/photo.jpg", file("image/jpeg")], ["/index.html", file("text/html")]]);
  const img = (u: string) => edgeImages(new Request("https://site.example/_optz/image"), new URL(`https://site.example/_optz/image?url=${encodeURIComponent(u)}`), files);

  test("the image endpoint only serves this app's own images, as a mutable response", async () => {
    const ok = await img("/photo.jpg");
    expect(ok.status).toBe(200);
    ok.headers.set("X-Request-Id", "1");
    for (const bad of ["https://evil.example/p.png", "//evil.example/p.png", "/index.html", "/nope.png"]) expect((await img(bad)).status).toBe(404);
  });

  test("after() work is handed to the platform's waitUntil", async () => {
    const a = await app({});
    const waited: Promise<unknown>[] = [];
    const r = await a.fetch(new Request("https://site.example/api/later"), { waitUntil: (p) => waited.push(p) });
    expect(await r.text()).toBe("ok");
    expect(waited).toHaveLength(1);
    await waited[0];
  });
});
