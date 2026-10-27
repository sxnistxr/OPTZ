// The Next.js-parity features, end to end: builds apps/features and sends requests to the
// handler in-process (no network server). Browser-side checks are in apps/features/e2e.cjs.
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { actionUrl, isActionSource, tagAction } from "../src/actions";
import { fallbackFace } from "../src/fonts";
import { createApp, pickLocale, type App } from "../src/handler";
import type { Manifest } from "../src/manifest";
import { inScope, matchRoute, scanRoutes } from "../src/routes";
import { robotsTxt, sitemapXml } from "../src/seo";
import { serializeCookie } from "../src/server-api";
import { bunPlatform, loadMiddleware, loadStatic } from "../src/server";
import { resolveConfig, type Config } from "../src/types";

function tree(files: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "optz-"));
  for (const f of files) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    writeFileSync(join(dir, f), "export default () => null;\n");
  }
  return dir;
}

describe("routing", () => {
  test("optional catch-all matches with and without segments", () => {
    const t = scanRoutes(tree(["docs/[[...slug]].tsx", "docs/faq.tsx"]));
    expect(matchRoute(t.routes, "/docs")!.params).toEqual({});
    expect(matchRoute(t.routes, "/docs/a/b")!.params).toEqual({ slug: "a/b" });
    expect(matchRoute(t.routes, "/docs/faq")!.route.pattern).toBe("/docs/faq");
  });

  test("slots attach to their layout; intercepts aren't normal routes", () => {
    const t = scanRoutes(
      tree(["_layout.tsx", "feed/_layout.tsx", "feed/index.tsx", "feed/photo/[id].tsx", "feed/@modal/default.tsx", "feed/@modal/(.)photo/[id].tsx", "(..)top/x.tsx", "_loading.tsx"]),
    );
    expect(t.routes.map((r) => r.pattern).sort()).toEqual(["/feed", "/feed/photo/[id]"]);
    expect(t.slots).toHaveLength(1);
    expect(t.slots[0].name).toBe("modal");
    expect(t.slots[0].default).toEndWith("default.tsx");
    expect(t.slots[0].intercepts[0].pattern).toBe("/feed/photo/[id]");
    expect(inScope(t.slots[0].intercepts[0].scope!, "/feed")).toBe(true);
    expect(inScope(t.slots[0].intercepts[0].scope!, "/other")).toBe(false);
    expect(t.routes[0].loading).toEndWith("_loading.tsx");
  });

  test("a slot without a layout next to it is an error", () => {
    expect(() => scanRoutes(tree(["a/@x/index.tsx"]))).toThrow(/needs a _layout/);
  });
});

test("Accept-Language picks the best locale", () => {
  expect(pickLocale("fr-CA,fr;q=0.9,en;q=0.8", ["en", "fr"])).toBe("fr");
  expect(pickLocale("de-DE,de;q=0.9", ["en", "fr"])).toBeUndefined();
  expect(pickLocale("en-GB;q=0.5,fr;q=0.9", ["en", "fr"])).toBe("fr");
});

test("sitemap, robots and cookies serialize correctly", () => {
  expect(sitemapXml([{ url: "/a&b", priority: 0.5 }], "https://x.dev")).toContain("<loc>https://x.dev/a&#38;b</loc><priority>0.5</priority>");
  expect(robotsTxt({ rules: [{ disallow: "/api/" }], sitemap: "/sitemap.xml" }, "https://x.dev")).toBe("User-Agent: *\nDisallow: /api/\n\nSitemap: https://x.dev/sitemap.xml\n");
  expect(serializeCookie("a", "b c", { maxAge: 10 })).toBe("a=b%20c; Path=/; Max-Age=10; HttpOnly; SameSite=Lax");
});

test("font fallbacks are scaled to the web font's metrics", () => {
  const css = fallbackFace("X", { unitsPerEm: 1000, ascent: 900, descent: -250, lineGap: 0, avgWidth: 904 / 2.048 }, "Arial");
  expect(css).toContain("size-adjust:100.00%");
  expect(css).toContain("ascent-override:90.00%");
  expect(css).toContain("descent-override:25.00%");
});

test("server actions: directive detection and progressive-enhancement form data", () => {
  expect(isActionSource('// hi\n"use server";\nexport async function a() {}')).toBe(true);
  expect(isActionSource('import x from "y";\n"use server";')).toBe(false);
  const fn = tagAction(async (_id: unknown, _f: unknown) => {}, "abc", "save") as unknown as { bind: (...a: unknown[]) => { $$FORM_ACTION: () => { action: string; data: FormData } } };
  const bound = fn.bind(null, 7).$$FORM_ACTION();
  expect(bound.action).toBe(actionUrl("abc", "save"));
  expect(bound.data.get("$optz_bound")).toBe("[7]");
});

// ---- the features app, in-process ----------------------------------------------------------

const root = join(import.meta.dir, "../../apps/features");
let app: App;
let manifest: Manifest;
const get = (path: string, headers: Record<string, string> = {}) => app.fetch(new Request(`http://localhost${path}`, { headers }));
const post = (path: string, body: BodyInit, headers: Record<string, string> = {}) => app.fetch(new Request(`http://localhost${path}`, { method: "POST", body, headers }));

describe("features app", () => {
  beforeAll(async () => {
    const user = (await import(join(root, "optz.config.ts"))).default as Config;
    // No font download in tests.
    const config = resolveConfig({ ...user, fonts: undefined });
    const { build } = await import("../src/build");
    manifest = await build({ root, config });
    app = await createApp({ manifest, config, files: loadStatic(join(root, "dist/static")), platform: bunPlatform(root, config), middleware: await loadMiddleware(root, config) });
  }, 60_000);

  test("static pages come from memory; / redirects by Accept-Language", async () => {
    expect((await get("/docs/guide/setup")).status).toBe(200);
    const r = await get("/", { "Accept-Language": "fr" });
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("/fr");
    expect(await (await get("/fr")).text()).toContain("Bonjour");
    expect((await get("/en/docs")).headers.get("location")).toBe("/docs");
  });

  test("dynamic pages stream, with a CSP nonce for React's scripts", async () => {
    const r = await get("/stream");
    const csp = r.headers.get("content-security-policy")!;
    const nonce = csp.match(/'nonce-([^']+)'/)![1];
    const html = await r.text();
    expect(r.headers.get("x-optz-nonce")).toBeNull();
    expect(html).toContain(`nonce="${nonce}"`);
    const text = html.replace(/<!-- -->/g, "");
    expect(text).toContain("a after 300 ms");
    expect(text).toContain("b after 600 ms");
  });

  test("a page that throws renders _error.tsx with status 500", async () => {
    const r = await get("/boom");
    expect(r.status).toBe(500);
    expect(await r.text()).toContain("kaboom");
  });

  test("Server Actions: JSON calls, ActionError, CSRF and no-JS form posts", async () => {
    const id = Object.keys(manifest.actions)[0];
    const call = (name: string, args: unknown[]) => post(actionUrl(id, name), JSON.stringify(args), { "X-Optz-Action": "json", "Content-Type": "application/json" });
    expect(await (await call("countNotes", [])).json()).toMatchObject({ ok: true });
    const fd = new FormData();
    fd.set("text", "");
    expect(await (await post(actionUrl(id, "addNote"), fd, { "X-Optz-Action": "form" })).json()).toEqual({ ok: false, error: "Write something first." });
    const cross = new FormData();
    cross.set("text", "x");
    expect((await post(actionUrl(id, "addNote"), cross, { Origin: "https://evil.example" })).status).toBe(403);
    const same = new FormData();
    same.set("text", "from a form");
    const r = await post(actionUrl(id, "addNote"), same, { Origin: "http://localhost", Referer: "http://localhost/notes" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/notes");
    expect(await (await get("/notes")).text()).toContain("from a form");
    expect((await call("nope", [])).status).toBe(404);
  });

  test("ISR: revalidateTag rebuilds a static page in the background", async () => {
    const n = async () => Number((await (await get("/isr")).text()).match(/render <!-- -->(\d+)/)![1]);
    // revalidate = 2 may already have expired since the build: let that rebuild finish first.
    await n();
    await Bun.sleep(100);
    const first = await n();
    await post("/api/revalidate", JSON.stringify({ tag: "clock", secret: "dev-draft-secret" }), { "Content-Type": "application/json" });
    expect(await n()).toBe(first); // the stale copy, while it rebuilds
    await Bun.sleep(100);
    expect(await n()).toBeGreaterThan(first); // rebuilt (the counter is shared with the build's other renders)
  });

  test("dynamicParams renders unlisted ids once, then keeps them", async () => {
    const a = await (await get("/products/42")).text();
    const b = await (await get("/products/42")).text();
    expect(a).toContain("render <!-- -->1");
    expect(b).toBe(a);
    expect((await get("/products/x")).status).toBe(404);
  });

  test("intercepting route: the modal for in-app navigation, the page otherwise", async () => {
    const soft = await (await get("/gallery/photo/2", { "X-Optz-Swap": "1", "X-Optz-From": "/gallery" })).text();
    expect(soft).toContain('data-testid="photo-modal"');
    expect(soft).toContain('data-testid="gallery"');
    expect(await (await get("/gallery/photo/2")).text()).toContain('data-testid="photo-page"');
  });

  test("draft mode renders static pages per request, only with the signed cookie", async () => {
    const on = await get("/api/draft?secret=dev-draft-secret&to=/draft");
    const cookie = on.headers.get("set-cookie")!.split(";")[0];
    expect(await (await get("/draft", { Cookie: cookie })).text()).toContain("draft view");
    expect(await (await get("/draft", { Cookie: "__optz_draft=forged" })).text()).toContain("published view");
  });

  test("prerendered API route, sitemap and robots", async () => {
    expect(await (await get("/api/build-info")).json()).toMatchObject({ env: "build" });
    expect(await (await get("/sitemap.xml")).text()).toContain("<loc>https://features.example/</loc>");
    expect(await (await get("/robots.txt")).text()).toContain("Disallow: /api/");
  });
  test("MCP: app/mcp tools, prompts and resources, plus the site's pages, at /mcp", async () => {
    const rpc = async (method: string, params?: unknown, headers: Record<string, string> = {}) =>
      (await (await post("/mcp", JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers })).json()) as {
        result?: any;
        error?: { code: number; message: string };
      };
    const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.result.protocolVersion).toBe("2025-06-18");
    expect(init.result.serverInfo.name).toBe("features.example");
    expect(Object.keys(init.result.capabilities).sort()).toEqual(["logging", "prompts", "resources", "tools"]);
    expect((await post("/mcp", JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))).status).toBe(202);

    const tools = (await rpc("tools/list")).result.tools.map((t: { name: string }) => t.name);
    expect(tools).toEqual(["add", "search_pages", "read_page"]);
    const sum = (await rpc("tools/call", { name: "add", arguments: { numbers: [1, 2, 3.5] } }, { "User-Agent": "claude" })).result;
    expect(sum.structuredContent).toEqual({ sum: 6.5, agent: "claude" });
    const bad = (await rpc("tools/call", { name: "add", arguments: { numbers: ["x"] } })).result;
    expect(bad).toMatchObject({ isError: true, content: [{ text: "Invalid arguments: arguments.numbers[0] must be a number" }] });
    expect((await rpc("tools/call", { name: "nope" })).error!.code).toBe(-32602);

    const found = (await rpc("tools/call", { name: "search_pages", arguments: { query: "setup" } })).result.structuredContent.results;
    expect(found[0].path).toBe("/docs/guide/setup");
    const page = (await rpc("tools/call", { name: "read_page", arguments: { path: "https://features.example/docs/guide/setup" } })).result;
    expect(page.content[0].text).toContain("Source: https://features.example/docs/guide/setup");
    expect((await rpc("tools/call", { name: "read_page", arguments: { path: "/missing" } })).result.isError).toBe(true);

    expect((await rpc("prompts/get", { name: "explain", arguments: { path: "/" } })).result.messages[0].content.text).toContain("read_page");
    expect((await rpc("resources/templates/list")).result.resourceTemplates[0].uriTemplate).toBe("notes://{id}");
    expect((await rpc("resources/read", { uri: "notes://42" })).result.contents[0]).toEqual({ uri: "notes://42", mimeType: "text/plain", text: "Note 42" });
    expect((await rpc("resources/list")).result.resources.some((r: { uri: string }) => r.uri === "https://features.example/docs/guide/setup")).toBe(true);
    expect((await rpc("bogus")).error!.code).toBe(-32601);

    // A web page elsewhere can't drive it (DNS rebinding); the site's own origin can.
    expect((await post("/mcp", "{}", { Origin: "https://evil.example" })).status).toBe(403);
    expect((await rpc("ping", undefined, { Origin: "https://features.example" })).result).toEqual({});
    expect((await post("/mcp", "not json")).status).toBe(400);
    expect((await get("/mcp")).status).toBe(405);
  });

  test("llms.txt and llms-full.txt list the pages for language models", async () => {
    const txt = await (await get("/llms.txt")).text();
    expect(txt).toContain("This site is also an MCP server: https://features.example/mcp");
    expect(txt).toMatch(/- \[[^\]]+\]\(https:\/\/features\.example\/docs\/guide\/setup\)/);
    expect(await (await get("/llms-full.txt")).text()).toContain("Source: https://features.example/docs/guide/setup");
  });
  // ---- boundaries (audit: C3-C11, X3, X9, X10, A5, A10, A15) ----

  test("Server Actions trust site.url, not Host or X-Forwarded-Host (CSRF)", async () => {
    const id = Object.keys(manifest.actions)[0];
    const form = () => {
      const f = new FormData();
      f.set("text", "csrf");
      return f;
    };
    // A forged X-Forwarded-Host no longer makes a foreign origin look like ours.
    expect((await post(actionUrl(id, "addNote"), form(), { Origin: "https://evil.example", "X-Forwarded-Host": "evil.example" })).status).toBe(403);
    // DNS rebinding: Host and Origin both the attacker's name.
    const rebound = await app.fetch(new Request(`http://evil.example${actionUrl(id, "addNote")}`, { method: "POST", body: form(), headers: { Origin: "http://evil.example" } }));
    expect(rebound.status).toBe(403);
    // The configured site origin works.
    expect((await post(actionUrl(id, "addNote"), form(), { Origin: "https://features.example" })).status).toBe(303);
    // Malformed Origin and Referer: 403 and a safe redirect, never a 500.
    expect((await post(actionUrl(id, "addNote"), form(), { Origin: "http://[bad" })).status).toBe(403);
    const r = await post(actionUrl(id, "addNote"), form(), { Origin: "http://localhost", Referer: "http://[bad" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/");
  });

  test("malformed action arguments and names are 400/404, not 500", async () => {
    const id = Object.keys(manifest.actions)[0];
    for (const bad of ["not-json", '{"a":1}']) {
      const f = new FormData();
      f.set("$optz_args", bad);
      const r = await post(actionUrl(id, "addNote"), f, { "X-Optz-Action": "form" });
      expect(r.status).toBe(400);
    }
    expect((await post(`/_optz/action/${id}/%zz`, "[]", { "X-Optz-Action": "json" })).status).toBe(404);
    // ActionError is an expected outcome, with its own status.
    const empty = new FormData();
    empty.set("text", "");
    expect((await post(actionUrl(id, "addNote"), empty, { "X-Optz-Action": "form" })).status).toBe(422);
  });

  test("malformed percent-encoding is a 404, not a 500", async () => {
    for (const p of ["/products/%", "/products/%zz", "/products/%E0%A4%A", "/docs/%zz"]) expect((await get(p)).status).toBe(404);
  });

  test("handler().body(): 400 for bad JSON, 415 for other types; API 404s and 405s are JSON", async () => {
    expect((await post("/api/echo", '{"text":"hi"}', { "Content-Type": "application/json" })).status).toBe(201);
    const bad = await post("/api/echo", "{nope", { "Content-Type": "application/json" });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "The body isn't valid JSON." });
    expect((await post("/api/echo", '{"text":"hi"}', { "Content-Type": "text/plain" })).status).toBe(415);
    const missing = await get("/api/nothing-here");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toBe("application/json");
    const wrong = await get("/api/echo");
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get("allow")).toBe("POST");
  });

  test("intercepting routes don't render a page the middleware forbids (X-Optz-From)", async () => {
    expect((await get("/gallery/private")).status).toBe(403);
    const swapped = await get("/gallery/photo/1", { "X-Optz-Swap": "1", "X-Optz-From": "/gallery/private" });
    expect(await swapped.text()).not.toContain("private gallery secret");
    const admin = await get("/gallery/photo/1", { "X-Optz-Swap": "1", "X-Optz-From": "/gallery/private", Cookie: "admin=1" });
    expect(await admin.text()).toContain("private gallery secret");
  });

  test("draft mode: expiring signed cookie, on dynamic pages and data too, never cached", async () => {
    const on = await get("/api/draft?secret=dev-draft-secret&to=/preview");
    const setCookie = on.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/Max-Age=86400/);
    const cookie = setCookie.split(";")[0];
    // Every token is different.
    const again = (await get("/api/draft?secret=dev-draft-secret")).headers.get("set-cookie")!.split(";")[0];
    expect(again).not.toBe(cookie);
    // A cached dynamic page: the published copy is shared, the draft one is private.
    const published = await (await get("/preview")).text();
    expect(published).toContain("published");
    const draft = await get("/preview", { Cookie: cookie });
    expect(await draft.text()).toContain("draft preview");
    expect(draft.headers.get("cache-control")).toBe("private, no-store");
    expect(await (await get("/preview")).text()).toBe(published);
    // Suffix matches and expired tokens don't count.
    expect(await (await get("/draft", { Cookie: `x${cookie}` })).text()).toContain("published view");
    const [exp, nonce, sig] = cookie.split("=")[1].split(".");
    expect(await (await get("/draft", { Cookie: `__optz_draft=${Number(exp) - 200000}.${nonce}.${sig}` })).text()).toContain("published view");
    // The data endpoint sees draft mode too.
    const data = await get("/_optz/data/draft.json", { Cookie: cookie });
    expect(data.headers.get("cache-control")).toBe("private, no-store");
  });

  test("the data endpoint knows the locale", async () => {
    const r = await get("/_optz/data/fr/preview.json");
    expect(r.status).toBe(200);
    expect(JSON.stringify(await r.json())).toContain('"locale":"fr"');
  });

  test("ISR regenerates from an anonymous request: one visitor's cookie never lands in the shared page", async () => {
    const text = async (r: Response) => (await r.text()).replace(/<!-- -->/g, "");
    expect(await text(await get("/isr-visitor"))).toContain("cookie: none");
    await Bun.sleep(1100);
    await get("/isr-visitor", { Cookie: "u=alice" });
    await Bun.sleep(200);
    const html = await text(await get("/isr-visitor", { Cookie: "u=bob" }));
    expect(html).not.toContain("alice");
    expect(html).toContain("cookie: none");
  });

  test("cookies: names and attributes can't be injected; SameSite=None is Secure", () => {
    expect(() => serializeCookie("sid=abc; Domain=evil.example", "x")).toThrow();
    expect(() => serializeCookie("a\r\nSet-Cookie", "x")).toThrow();
    expect(() => serializeCookie("a", "x", { domain: "x; HttpOnly" })).toThrow();
    expect(serializeCookie("a", "x\r\n", { sameSite: "none" })).toBe("a=x%0D%0A; Path=/; Secure; HttpOnly; SameSite=None");
  });
});
