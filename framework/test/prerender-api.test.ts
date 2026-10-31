import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "../src/build";
import { createApp } from "../src/handler";
import { apiStaticPath } from "../src/manifest";
import { bunPlatform, loadStatic } from "../src/server";
import { resolveConfig } from "../src/types";

test("parent and child API prerenders coexist and retain their response headers", async () => {
  const temp = join(import.meta.dir, "../.tmp");
  mkdirSync(temp, { recursive: true });
  const root = mkdtempSync(join(temp, "prerender-api-"));
  const config = resolveConfig({ features: { images: false, mcp: false } });
  try {
    mkdirSync(join(root, "app/routes"), { recursive: true });
    mkdirSync(join(root, "app/api/items"), { recursive: true });
    const source = (body: string) => `export const prerender = true; export const GET = () => new Response(${JSON.stringify(body)}, {headers: {"Content-Type":"text/plain", "Access-Control-Allow-Origin":"*", "X-Example":"retained", "Content-Disposition":"attachment; filename=items.txt", "Cache-Control":"public, max-age=120", "Vary":"Origin"}});`;
    writeFileSync(join(root, "app/api/items.ts"), source("parent"));
    writeFileSync(join(root, "app/api/items/one.ts"), source("child"));
    const manifest = await build({ root, config });
    const app = await createApp({ manifest, config, files: loadStatic(join(root, "dist/static")), platform: bunPlatform(root, config) });
    for (const [path, text] of [["/api/items", "parent"], ["/api/items/one", "child"]]) {
      const response = await app.fetch(new Request("https://site.test" + path));
      expect(await response.text()).toBe(text);
      expect(response.headers.get("access-control-allow-origin")).toBe("*");
      expect(response.headers.get("x-example")).toBe("retained");
      expect(response.headers.get("content-disposition")).toContain("attachment");
      expect(response.headers.get("cache-control")).toBe("public, max-age=120");
      expect(response.headers.get("vary")).toBe("accept-encoding, origin");
      const head = await app.fetch(new Request("https://site.test" + path, { method: "HEAD" }));
      expect(await head.text()).toBe("");
      const conditional = await app.fetch(new Request("https://site.test" + path, { headers: { "If-None-Match": response.headers.get("etag")! } }));
      expect(conditional.status).toBe(304);
      expect(conditional.headers.get("x-example")).toBe("retained");
    }
    expect(apiStaticPath("/api/items/$response")).not.toContain("/$response/$response");
    expect(apiStaticPath("/api/items/%24response")).not.toBe(apiStaticPath("/api/items/$response"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
