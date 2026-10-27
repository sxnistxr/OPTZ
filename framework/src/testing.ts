// optz/test: an app's real build, served in-process for tests (no port, no network):
//
//   import { createTestApp } from "optz/test";
//   const app = await createTestApp({ root: import.meta.dir + "/.." });
//   const res = await app.get("/api/stats");
//   expect(await res.json()).toEqual({ ... });
//   const created = await app.post("/api/notes", { text: "hi" });      // JSON body
//   const page = await app.html("/blog/hello");                          // the page as text
//
// It runs `optz build` (into dist/, like a deploy) unless `build: false`, then the same handler
// `optz start` uses, with the app's middleware.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp, type App } from "./handler";
import { outDirFor, parseManifest } from "./manifest";
import { bunPlatform, loadMiddleware, loadStatic } from "./server";
import { resolveConfig, type Config, type ResolvedConfig } from "./types";

export interface TestAppOptions {
  /** The project directory (where optz.config.ts is). */
  root: string;
  /** Overrides merged into the project's config. */
  config?: Config;
  /** Build first. Default true; false serves the existing dist/. */
  build?: boolean;
  /** The origin requests appear to come from. Default "http://localhost". */
  origin?: string;
}

export interface TestApp extends App {
  config: ResolvedConfig;
  /** GET a path (relative to `origin`). */
  get(path: string, headers?: Record<string, string>): Promise<Response>;
  /** POST JSON (objects) or a raw body (strings, FormData). */
  post(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
  /** Any method and init. */
  request(path: string, init?: RequestInit): Promise<Response>;
  /** GET a page and return its HTML (React's "<!-- -->" text separators removed). */
  html(path: string): Promise<string>;
}

export async function createTestApp({ root, config: overrides = {}, build = true, origin = "http://localhost" }: TestAppOptions): Promise<TestApp> {
  const file = ["optz.config.ts", "optz.config.js"].map((f) => join(root, f)).find(existsSync);
  const user = file ? (((await import(file)).default ?? {}) as Config) : {};
  const config = resolveConfig({ ...user, ...overrides });
  if (build) {
    const { build: run } = await import("./build");
    const log = console.log;
    console.log = () => {};
    try {
      await run({ root, config });
    } finally {
      console.log = log;
    }
  }
  const out = outDirFor(root);
  const manifest = parseManifest(readFileSync(join(out, "manifest.json"), "utf8"));
  const app = await createApp({ manifest, config, files: loadStatic(join(out, "static")), platform: bunPlatform(root, config), middleware: await loadMiddleware(root, config) });
  const request = (path: string, init?: RequestInit) => app.fetch(new Request(new URL(path, origin), init));
  return {
    ...app,
    config,
    request,
    get: (path, headers) => request(path, { headers }),
    post: (path, body, headers = {}) => {
      const raw = typeof body === "string" || body instanceof FormData || body instanceof URLSearchParams || body === undefined;
      return request(path, { method: "POST", body: raw ? (body as BodyInit | undefined) : JSON.stringify(body), headers: raw ? headers : { "Content-Type": "application/json", ...headers } });
    },
    html: async (path) => (await (await request(path)).text()).replace(/<!-- -->/g, ""),
  };
}
