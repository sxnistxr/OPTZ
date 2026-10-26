// `optz start` (and the dev server): the request handler (handler.ts) on Bun.serve, with
// static files loaded from dist/static into memory and Bun's native hashing and compression.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { brotliCompressSync, constants as zc } from "node:zlib";
import { createApp, type Platform } from "./handler";
import { outDirFor, type Manifest } from "./manifest";
import { registerIslandLoader } from "./plugin";
import { cacheFor, typeOf, type StaticEntry } from "./static";
import type { Middleware, ResolvedConfig } from "./types";

export function loadStatic(dir: string): Map<string, StaticEntry> {
  const map = new Map<string, StaticEntry>();
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) {
        walk(f);
        continue;
      }
      if (f.endsWith(".gz") || f.endsWith(".br")) continue;
      const url = "/" + relative(dir, f).split("\\").join("/");
      const body = readFileSync(f);
      map.set(url, {
        body,
        br: existsSync(`${f}.br`) ? readFileSync(`${f}.br`) : undefined,
        gz: existsSync(`${f}.gz`) ? readFileSync(`${f}.gz`) : undefined,
        type: typeOf(f),
        etag: `"${Bun.hash(body).toString(36)}"`,
        cache: cacheFor(url),
      });
    }
  };
  if (existsSync(dir)) walk(dir);
  return map;
}

export function bunPlatform(root: string, config: ResolvedConfig): Platform {
  return {
    load: (f) => import(join(root, f)),
    hash: (b) => Bun.hash(b).toString(36),
    gzip: (b) => Bun.gzipSync(b as Uint8Array<ArrayBuffer>, { level: 6 }),
    // Quality 5: fast enough per response, and still smaller than gzip.
    brotli: (b) => brotliCompressSync(b, { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } }),
    images: async (req, url, files) => (await import("./image")).handleImage(req, url, { root, config, files }),
    og: async (mod, props) => (await import("./og")).renderOg(root, mod as never, props),
  };
}

export async function loadMiddleware(root: string, config: ResolvedConfig): Promise<Middleware[]> {
  if (!config.features.middleware) return [];
  for (const f of ["app/middleware.ts", "app/middleware.tsx", "app/middleware.js"]) {
    if (!existsSync(join(root, f))) continue;
    const m = (await import(join(root, f))) as { default?: Middleware | Middleware[] };
    return m.default ? (Array.isArray(m.default) ? m.default : [m.default]) : [];
  }
  return [];
}

export interface ServeOptions {
  root: string;
  config: ResolvedConfig;
  dev?: boolean;
  port?: number;
  hostname?: string;
}

export async function serve({ root, config, dev, port, hostname }: ServeOptions) {
  const out = outDirFor(root, dev);
  const manifest: Manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  if (manifest.mode === "islands") registerIslandLoader(root);
  const files = loadStatic(join(out, "static"));
  const app = await createApp({ manifest, config, files, platform: bunPlatform(root, config), middleware: await loadMiddleware(root, config), dev });
  const dv = dev ? await import("./dev") : null;

  const server = Bun.serve({
    port: port ?? Number(process.env.PORT ?? config.port ?? 3001),
    hostname: hostname ?? process.env.HOST ?? config.hostname ?? "127.0.0.1",
    development: dev ?? false,
    idleTimeout: config.server.idleTimeout,
    maxRequestBodySize: config.server.maxRequestBodySize,
    fetch(req) {
      if (dv) {
        const p = req.url.slice(req.url.indexOf("/", 8));
        if (p.startsWith("/_optz/dev/")) return dv.devRequest(req, p, app.cache);
      }
      return app.fetch(req);
    },
  });
  const feats = Object.entries(config.features).filter(([, v]) => v).map(([k]) => k).join(", ");
  console.log(`optz: ${dev ? "dev server" : "serving"} on http://${server.hostname}:${server.port} (${files.size} files in memory, ${manifest.routes.length} routes, ${manifest.mode}; features: ${feats})`);
  return { server, cache: app.cache };
}
