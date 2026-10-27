import { codeLiteral } from "./code-literal";
// One-file servers from a build:
//
//   optz build --compile       dist/server: a single executable (the Bun runtime, your code, the
//                              built pages and assets). Copy it to a machine and run it; nothing
//                              to install.
//   optz build --target edge   dist/edge/worker.js: `export default { fetch }` for Cloudflare
//                              Workers (Node compatibility on), Deno Deploy, Vercel Edge or any
//                              runtime with web-standard Request/Response. Static files are
//                              embedded; Server Actions, streaming, ISR, i18n all work.
//
// Both statically import every module the handler can load at runtime, so there's no file system
// access after startup. Image optimization needs native code: without it, images are served
// unchanged. Open Graph images of static pages are prebuilt; others need the Bun server.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { BunPlugin } from "bun";
import type { Manifest } from "./manifest";
import { islandBuildPlugin } from "./plugin";
import { typeOf, cacheFor } from "./static";
import type { ResolvedConfig } from "./types";

export interface ServerBundleOptions {
  root: string;
  config: ResolvedConfig;
  manifest: Manifest;
  target: "bun" | "edge";
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const f = join(dir, e);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
}

/** Every project module the handler may `load()`. */
function serverModules(root: string, m: Manifest): string[] {
  const files = new Set<string>();
  const add = (f?: string) => f && files.add(f);
  const route = (r: Manifest["routes"][number]) => {
    add(r.file);
    r.layouts.forEach(add);
    add(r.error);
    add(r.loading);
    add(r.og);
  };
  m.routes.forEach(route);
  m.intercepts.forEach(route);
  for (const s of m.slots) {
    s.routes.forEach(route);
    s.intercepts.forEach(route);
    add(s.default);
  }
  add(m.notFound);
  m.rootLayouts.forEach(add);
  Object.values(m.actions).forEach((a) => add(a.file));
  (m.mcp ?? []).forEach(add);
  for (const f of ["app/middleware.ts", "app/middleware.tsx", "app/middleware.js", "app/scheduled.ts", "app/scheduled.js"]) if (existsSync(join(root, f))) add(f);
  return [...files];
}

export async function buildServerBundle({ root, config, manifest, target }: ServerBundleOptions): Promise<string> {
  const t0 = performance.now();
  const gen = join(root, ".optz/gen/server");
  mkdirSync(gen, { recursive: true });
  const fw = import.meta.dir;
  const imp = (p: string) => codeLiteral(p);
  const modules = serverModules(root, manifest);
  const configFile = ["optz.config.ts", "optz.config.js"].map((f) => join(root, f)).find(existsSync);

  // ---- static files ----
  const staticDir = join(root, "dist/static");
  const files = walk(staticDir).filter((f) => !f.endsWith(".gz") && !f.endsWith(".br"));
  let staticSrc: string;
  if (target === "bun") {
    // Embedded in the executable; read once at startup.
    const lines: string[] = [];
    const entries: string[] = [];
    files.forEach((f, i) => {
      lines.push(`import f${i} from ${imp(f)} with { type: "file" };`);
      const br = existsSync(`${f}.br`) ? (lines.push(`import b${i} from ${imp(f + ".br")} with { type: "file" };`), `b${i}`) : "null";
      const gz = existsSync(`${f}.gz`) ? (lines.push(`import g${i} from ${imp(f + ".gz")} with { type: "file" };`), `g${i}`) : "null";
      entries.push(`  [${imp("/" + relative(staticDir, f))}, f${i}, ${br}, ${gz}],`);
    });
    staticSrc = `${lines.join("\n")}
const list: [string, string, string | null, string | null][] = [
${entries.join("\n")}
];
const read = async (p: string | null) => (p ? new Uint8Array(await Bun.file(p).arrayBuffer()) : undefined);
export async function staticFiles() {
  const map = new Map();
  for (const [url, f, br, gz] of list) {
    const body = (await read(f))!;
    map.set(url, { body, br: await read(br), gz: await read(gz), type: typeOf(url), etag: '"' + Bun.hash(body).toString(36) + '"', cache: cacheFor(url) });
  }
  return map;
}
import { typeOf, cacheFor } from ${imp(join(fw, "static.ts"))};
`;
  } else {
    // Base64 in the bundle: workers have no file system.
    const entries = files.map((f) => {
      const url = "/" + relative(staticDir, f);
      const b64 = (p: string) => (existsSync(p) ? imp(readFileSync(p).toString("base64")) : "null");
      // Workers compress responses themselves (a pre-compressed body would be encoded twice).
      return `  [${imp(url)}, ${b64(f)}],`;
    });
    staticSrc = `import { fnv } from ${imp(join(fw, "static.ts"))};
const list: [string, string][] = [
${entries.join("\n")}
];
const dec = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const types = ${codeLiteral(Object.fromEntries(files.map((f) => ["/" + relative(staticDir, f), [typeOf(f), cacheFor("/" + relative(staticDir, f))]])))};
export async function staticFiles() {
  const map = new Map();
  for (const [url, b] of list) {
    const body = dec(b);
    map.set(url, { body, type: types[url][0], etag: '"' + fnv(body) + '"', cache: types[url][1] });
  }
  return map;
}
`;
  }
  writeFileSync(join(gen, "static-files.ts"), staticSrc);

  // ---- the entry ----
  const loaders = modules.map((f) => `  ${imp(f)}: () => import(${imp(join(root, f))}),`).join("\n");
  const common = `import { createApp, middlewareFrom } from ${imp(join(fw, "handler.ts"))};
import { resolveConfig } from ${imp(join(fw, "types.ts"))};
import { staticFiles } from "./static-files.ts";
${configFile ? `import userConfig from ${imp(configFile)};` : "const userConfig = {};"}
const manifest = ${codeLiteral(manifest)};
const modules: Record<string, () => Promise<unknown>> = {
${loaders}
};
const config = resolveConfig(userConfig as never);
const load = (f: string) => {
  const m = modules[f];
  if (!m) throw new Error("optz: module not in the server bundle: " + f);
  return m();
};
const mwFile = ${imp(modules.find((f) => f.startsWith("app/middleware.")) ?? "")};
const middleware = async () => {
  if (!config.features.middleware || !mwFile) return [];
  return middlewareFrom((await load(mwFile)) as never);
};
`;
  const entry =
    target === "bun"
      ? `${common}
import { brotliCompressSync, constants as zc } from "node:zlib";
process.env.NODE_ENV ??= "production";
const files = await staticFiles();
const app = await createApp({
  manifest: manifest as never,
  config,
  files,
  middleware: (await middleware()) as never,
  platform: {
    load,
    hash: (b) => Bun.hash(b).toString(36),
    gzip: (b) => Bun.gzipSync(b as Uint8Array<ArrayBuffer>, { level: 6 }),
    brotli: (b) => brotliCompressSync(b, { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } }),
    images: async (req, url, f) => (await import(${imp(join(fw, "image.ts"))})).handleImage(req, url, { root: process.cwd(), config, files: f }),
  },
});
const server = Bun.serve({
  port: Number(process.env.PORT ?? config.port ?? 3001),
  hostname: process.env.HOST ?? config.hostname ?? "127.0.0.1",
  idleTimeout: config.server.idleTimeout,
  maxRequestBodySize: config.server.maxRequestBodySize,
  fetch: app.fetch,
});
console.log("optz: serving on http://" + server.hostname + ":" + server.port + " (single binary, " + files.size + " files embedded)");
`
      : `import { createWorker } from ${imp(join(fw, "edge.ts"))};
import { resolveConfig } from ${imp(join(fw, "types.ts"))};
import { staticFiles } from "./static-files.ts";
${configFile ? `import userConfig from ${imp(configFile)};` : "const userConfig = {};"}
const manifest = ${codeLiteral(manifest)};
// fetch(request, env, ctx) and scheduled(event, env, ctx), with env and waitUntil passed to the app.
export default createWorker({
  manifest: manifest as never,
  config: resolveConfig(userConfig as never),
  files: staticFiles,
  modules: {
${loaders}
  },
});
`;
  const entryFile = join(gen, "entry.ts");
  writeFileSync(entryFile, entry);

  // Server bundles get the real "use server" modules (stubs are for browsers).
  const plugins: BunPlugin[] = [islandBuildPlugin(root)];
  const out = target === "bun" ? join(root, "dist/server") : join(root, "dist/edge/worker.js");
  const result = await Bun.build({
    entrypoints: [entryFile],
    target: target === "bun" ? "bun" : "browser",
    format: "esm",
    minify: true,
    // Edge runtimes: React's web-streams server build, Node built-ins from the platform.
    conditions: target === "edge" ? ["workerd", "worker", "edge-light", "browser"] : [],
    external: target === "edge" ? ["node:*", "sharp", "satori", "@resvg/resvg-js"] : ["sharp", "satori", "@resvg/resvg-js"],
    define: { "process.env.NODE_ENV": codeLiteral("production") },
    plugins,
    ...(target === "bun" ? { compile: { outfile: out } } : { outdir: join(root, "dist/edge"), naming: "worker.js" }),
  } as Parameters<typeof Bun.build>[0]);
  if (!result.success) throw new AggregateError(result.logs, "server bundle failed");
  if (target === "edge") {
    writeFileSync(
      join(root, "dist/edge/wrangler.toml"),
      `# Deploy with: npx wrangler deploy (from dist/edge)\nname = "${(config.site?.url && new URL(config.site.url).hostname.replace(/\./g, "-")) || "optz-app"}"\nmain = "worker.js"\ncompatibility_date = "2026-09-01"\n# The request context uses AsyncLocalStorage: explicit, so older compatibility dates work too.\ncompatibility_flags = ["nodejs_als"]\n${existsSync(join(root, "app/scheduled.ts")) || existsSync(join(root, "app/scheduled.js")) ? '\n# app/scheduled.ts runs on these Cron Triggers (edit them).\n[triggers]\ncrons = ["0 * * * *"]\n' : ""}`,
    );
  }
  const size = statSync(out).size;
  console.log(`optz: ${target === "bun" ? "single executable" : "edge worker"} ${relative(root, out)} (${(size / 1048576).toFixed(1)} MB, ${files.length} files embedded, ${modules.length} modules) in ${Math.round(performance.now() - t0)} ms`);
  return out;
}
