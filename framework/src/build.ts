// `optz build`: everything a production server (or a plain static host) needs, in dist/.
//
//   dist/static/            servable as-is: pre-rendered pages (path/index.html), their data
//                           (/_optz/data/*.json), hashed assets (/assets/*), public/ files, and
//                           .gz/.br next to every text file
//   dist/manifest.json      routes, render modes, chunks and redirects, for `optz start`
import { brotliCompressSync, constants as zc, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { BunPlugin } from "bun";
import { renderPage } from "./render";
import { dataPath, fillPattern, scanRoutes, type Route, type Segment } from "./routes";
import type { Config, ErrorModule, LayoutModule, PageModule, RenderMode } from "./types";

export interface ManifestRoute {
  pattern: string;
  segments: Segment[];
  file: string;
  kind: "page" | "api";
  render: RenderMode;
  hasLoader: boolean;
  layouts: string[];
  error?: string;
  preload: string[];
  shell?: string;
}

export interface Manifest {
  version: 1;
  entry: string;
  css: string[];
  routes: ManifestRoute[];
  notFound?: string;
  rootLayouts: string[];
  redirects: Record<string, { status: number; location: string }>;
}

export interface BuildOptions {
  root: string;
  config: Config;
  dev?: boolean;
  /** For `optz export`: refuse server-only features. */
  exportOnly?: boolean;
}

export const outDirFor = (root: string, dev?: boolean) => (dev ? join(root, ".optz/dev") : join(root, "dist"));

const hash = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex").slice(0, 10);
const rel = (root: string, f: string) => relative(root, f);

/** Removes server-only exports (loader, paths) from route files in browser bundles, and the
 *  imports only they used, so server code (fs, secrets) never reaches the browser. */
function stripServerExports(routesDir: string): BunPlugin {
  const transpiler = new Bun.Transpiler({
    loader: "tsx",
    exports: { eliminate: ["loader", "paths"] },
    trimUnusedImports: true,
    tsconfig: JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "react" } }),
  });
  return {
    name: "optz-strip-server-exports",
    setup(build) {
      build.onLoad({ filter: /\.(tsx|jsx)$/ }, async (args) => {
        if (!args.path.startsWith(routesDir)) return undefined;
        const src = await Bun.file(args.path).text();
        let js = transpiler.transformSync(src);
        // transformSync emits calls to renamed JSX runtime helpers (jsx_ab12cd34, ...) without
        // the import that defines them; add it for exactly the helpers used.
        const helpers = [...new Set(js.match(/\b(?:jsxs?|Fragment)_[a-z0-9]{8}\b/g) ?? [])];
        if (helpers.length) js = `import { ${helpers.map((h) => `${h.slice(0, h.lastIndexOf("_"))} as ${h}`).join(", ")} } from "react/jsx-runtime";\n${js}`;
        return { contents: js, loader: "js" };
      });
    },
  };
}

async function routeMode(file: string): Promise<{ render: RenderMode; hasLoader: boolean; mod: PageModule }> {
  const mod = (await import(file)) as PageModule;
  if (typeof mod.default !== "function") throw new Error(`${file}: a page must export a default React component`);
  return { render: mod.config?.render ?? "static", hasLoader: typeof mod.loader === "function", mod };
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const f = join(dir, e);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
}

const TEXT = /\.(html|js|mjs|css|json|svg|txt|xml|map)$/;

function precompress(dir: string) {
  for (const f of walk(dir)) {
    if (!TEXT.test(f)) continue;
    const buf = readFileSync(f);
    if (buf.length < 512) continue;
    writeFileSync(`${f}.gz`, gzipSync(buf, { level: 9 }));
    writeFileSync(`${f}.br`, brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 11, [zc.BROTLI_PARAM_SIZE_HINT]: buf.length } }));
  }
}

async function buildCss(root: string, config: Config, assetsDir: string, dev?: boolean): Promise<string[]> {
  const entry = join(root, config.css ?? "app/styles.css");
  if (!existsSync(entry)) return [];
  const cliPkg = Bun.resolveSync("@tailwindcss/cli/package.json", import.meta.dir);
  const pkg = JSON.parse(readFileSync(cliPkg, "utf8"));
  const bin = join(dirname(cliPkg), typeof pkg.bin === "string" ? pkg.bin : Object.values(pkg.bin)[0] as string);
  const tmp = join(assetsDir, "styles.tmp.css");
  const p = Bun.spawnSync([process.execPath, bin, "-i", entry, "-o", tmp, ...(dev ? [] : ["--minify"])], { cwd: root, stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`tailwind failed:\n${p.stderr.toString()}`);
  const css = readFileSync(tmp);
  const name = `styles-${hash(css)}.css`;
  writeFileSync(join(assetsDir, name), css);
  rmSync(tmp);
  return [`/assets/${name}`];
}

export async function build({ root, config, dev, exportOnly }: BuildOptions): Promise<Manifest> {
  const t0 = performance.now();
  const routesDir = join(root, "app/routes");
  const out = outDirFor(root, dev);
  const staticDir = join(out, "static");
  const assetsDir = join(staticDir, "assets");
  const gen = join(root, ".optz/gen");
  rmSync(out, { recursive: true, force: true });
  rmSync(gen, { recursive: true, force: true });
  mkdirSync(assetsDir, { recursive: true });
  mkdirSync(gen, { recursive: true });

  const table = scanRoutes(routesDir);
  const pages = table.routes.filter((r) => r.kind === "page");
  const modes = new Map<Route, Awaited<ReturnType<typeof routeMode>>>();
  for (const r of pages) modes.set(r, await routeMode(r.file));

  if (exportOnly) {
    const bad = table.routes.filter((r) => r.kind === "api" || modes.get(r)?.render === "dynamic");
    if (bad.length) throw new Error(`optz export makes a static site, but these need a server:\n${bad.map((r) => `  ${r.pattern} (${r.kind === "api" ? "API route" : "dynamic page"})`).join("\n")}`);
    if (existsSync(join(root, "app/middleware.ts"))) console.warn("optz export: app/middleware.ts doesn't run on a static host");
  }

  // ---- browser bundles: one small entry, one chunk per page/layout ----
  const layoutFiles = [...new Set(pages.flatMap((r) => r.layouts))];
  const errorFiles = [...new Set(pages.flatMap((r) => (r.error ? [r.error] : [])))];
  const wrapper = (name: string, file: string) => {
    const p = join(gen, `${name}.tsx`);
    writeFileSync(p, `export * from ${JSON.stringify(file)};\nexport { default } from ${JSON.stringify(file)};\n`);
    return p;
  };
  const pageW = pages.map((r, i) => wrapper(`p${i}`, r.file));
  const layoutW = layoutFiles.map((f, i) => wrapper(`l${i}`, f));
  const errorW = errorFiles.map((f, i) => wrapper(`e${i}`, f));
  const imp = (p: string) => `() => import(${JSON.stringify("./" + relative(gen, p))})`;
  const entrySrc = `import { start } from "optz/runtime";
start([
${pages
  .map((r, i) => {
    const m = modes.get(r)!;
    return `  { pattern: ${JSON.stringify(r.pattern)}, segments: ${JSON.stringify(r.segments)}, render: ${JSON.stringify(m.render)}, hasLoader: ${m.hasLoader}, load: ${imp(pageW[i])}, layouts: [${r.layouts.map((l) => imp(layoutW[layoutFiles.indexOf(l)])).join(", ")}]${r.error ? `, error: ${imp(errorW[errorFiles.indexOf(r.error)])}` : ""} },`;
  })
  .join("\n")}
]);
`;
  const entryFile = join(gen, "entry.tsx");
  writeFileSync(entryFile, entrySrc);

  const result = await Bun.build({
    entrypoints: [entryFile, ...pageW, ...layoutW, ...errorW],
    outdir: assetsDir,
    target: "browser",
    format: "esm",
    splitting: true,
    minify: !dev,
    sourcemap: dev ? "inline" : "none",
    naming: { entry: "[name]-[hash].[ext]", chunk: "c-[hash].[ext]", asset: "[name]-[hash].[ext]" },
    define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production") },
    plugins: [stripServerExports(routesDir)],
  });
  if (!result.success) throw new AggregateError(result.logs, "client build failed");
  const urlOf = (wrapperFile: string) => {
    const base = wrapperFile.split("/").pop()!.replace(/\.tsx$/, "");
    const o = result.outputs.find((o) => o.kind === "entry-point" && o.path.split("/").pop()!.startsWith(`${base}-`));
    return o ? `/assets/${relative(assetsDir, o.path)}` : undefined;
  };
  const entryUrl = urlOf(entryFile)!;

  const css = await buildCss(root, config, assetsDir, dev);
  if (existsSync(join(root, "public"))) cpSync(join(root, "public"), staticDir, { recursive: true });

  const manifest: Manifest = {
    version: 1,
    entry: entryUrl,
    css,
    routes: table.routes.map((r) => {
      const i = pages.indexOf(r);
      const m = modes.get(r);
      return {
        pattern: r.pattern,
        segments: r.segments,
        file: rel(root, r.file),
        kind: r.kind,
        render: m?.render ?? "dynamic",
        hasLoader: m?.hasLoader ?? false,
        layouts: r.layouts.map((l) => rel(root, l)),
        error: r.error && rel(root, r.error),
        preload: i < 0 ? [] : [urlOf(pageW[i]), ...r.layouts.map((l) => urlOf(layoutW[layoutFiles.indexOf(l)]))].filter(Boolean) as string[],
      };
    }),
    notFound: table.notFound && rel(root, table.notFound),
    rootLayouts: table.rootLayouts.map((l) => rel(root, l)),
    redirects: {},
  };

  // ---- pre-render static pages and client shells (production only; dev renders on demand) ----
  let rendered = 0;
  if (!dev) {
    const load = async <T,>(f: string) => (await import(join(root, f))) as T;
    for (const mr of manifest.routes) {
      if (mr.kind !== "page" || mr.render === "dynamic") continue;
      const page = await load<PageModule>(mr.file);
      const layouts = await Promise.all(mr.layouts.map((l) => load<LayoutModule>(l)));
      const error = mr.error ? await load<ErrorModule>(mr.error) : undefined;
      const assets = { entry: entryUrl, css, preload: mr.preload };
      if (mr.render === "client") {
        const r = await renderPage({ page, layouts, error, pattern: mr.pattern, pathname: mr.pattern, params: {}, skipLoader: true, ctx: { url: new URL("http://build" + mr.pattern), locals: {} } }, assets, config);
        if (r.kind !== "page") continue;
        mr.shell = `/_optz/shells/${hash(mr.pattern)}.html`;
        write(join(staticDir, mr.shell), r.html);
        rendered++;
        continue;
      }
      const hasParams = mr.segments.some((s) => s.kind !== "static");
      if (hasParams && !page.paths) throw new Error(`${mr.file}: a static page with parameters needs \`export function paths()\` (or \`export const config = { render: "dynamic" }\`)`);
      const sets = hasParams ? await page.paths!() : [{}];
      for (const params of sets) {
        const pathname = fillPattern(mr.segments, params);
        const r = await renderPage({ page, layouts, error, pattern: mr.pattern, pathname, params, ctx: { url: new URL("http://build" + pathname), locals: {} } }, assets, config);
        if (r.kind === "notFound") continue;
        if (r.kind === "redirect") {
          const location = r.response.headers.get("Location") ?? "/";
          manifest.redirects[pathname] = { status: r.response.status, location };
          write(join(staticDir, dataPath(pathname)), JSON.stringify({ redirect: location }));
          continue;
        }
        write(join(staticDir, pathname === "/" ? "index.html" : `${pathname.slice(1)}/index.html`), r.html);
        write(join(staticDir, dataPath(pathname)), JSON.stringify(r.payload));
        rendered++;
      }
    }
    // The not-found page, inside the root layouts.
    if (manifest.notFound) {
      const page = await load<PageModule>(manifest.notFound);
      const layouts = await Promise.all(manifest.rootLayouts.map((l) => load<LayoutModule>(l)));
      const r = await renderPage({ page, layouts, pattern: "/_404", pathname: "/_404", params: {}, ctx: { url: new URL("http://build/_404"), locals: {} } }, { entry: entryUrl, css, preload: [] }, config);
      if (r.kind === "page") write(join(staticDir, "404.html"), r.html.replace(/<script[^>]*>[\s\S]*?<\/script>\n/g, ""));
    }
    precompress(staticDir);
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
  const ms = Math.round(performance.now() - t0);
  console.log(`optz: built ${manifest.routes.length} routes${dev ? "" : `, pre-rendered ${rendered} pages`} in ${ms} ms -> ${relative(process.cwd(), out) || "."}`);
  return manifest;
}

function write(file: string, content: string | Uint8Array) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
