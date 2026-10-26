// `optz build`: everything a production server (or a plain static host) needs, in dist/.
//
//   dist/static/            servable as-is: pre-rendered pages (path/index.html), their data
//                           (/_optz/data/*.json, SPA mode), hashed assets (/assets/*),
//                           public/ files, and .gz/.br next to every text file
//   dist/manifest.json      routes, render modes, chunks and redirects, for `optz start`
import { brotliCompressSync, constants as zc, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { BunPlugin } from "bun";
import { writeTypes } from "./codegen";
import { outDirFor, type Manifest, type ManifestRoute } from "./manifest";
export { outDirFor, type Manifest, type ManifestRoute };
import { islandId, registerIslandLoader } from "./plugin";
import { renderPage } from "./render";
import { dataPath, fillPattern, scanApi, scanRoutes, sortRoutes, type Route, type Segment } from "./routes";
import type { ErrorModule, Hydrate, LayoutModule, PageModule, RenderMode, ResolvedConfig } from "./types";

export interface BuildOptions {
  root: string;
  config: ResolvedConfig;
  dev?: boolean;
  /** For `optz export`: refuse server-only features. */
  exportOnly?: boolean;
}


const hash = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex").slice(0, 10);
const rel = (root: string, f: string) => relative(root, f);

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((e) => {
    const f = join(dir, e);
    return statSync(f).isDirectory() ? walk(f) : [f];
  });
}

/** Removes server-only exports (loader, paths) from route files in SPA browser bundles, and
 *  the imports only they used, so server code (fs, secrets) never reaches the browser. */
function stripServerExports(routesDir: string): BunPlugin {
  const transpiler = new Bun.Transpiler({
    loader: "tsx",
    exports: { eliminate: ["loader", "paths", "cache"] },
    trimUnusedImports: true,
    tsconfig: JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "react" } }),
  });
  return {
    name: "optz-strip-server-exports",
    setup(build) {
      build.onLoad({ filter: /\.(tsx|jsx)$/ }, async (args) => {
        if (!args.path.startsWith(routesDir)) return undefined;
        let js = transpiler.transformSync(await Bun.file(args.path).text());
        // transformSync emits calls to renamed JSX runtime helpers (jsx_ab12cd34, ...) without
        // the import that defines them; add it for exactly the helpers used.
        const helpers = [...new Set(js.match(/\b(?:jsxs?|Fragment)_[a-z0-9]{8}\b/g) ?? [])];
        if (helpers.length) js = `import { ${helpers.map((h) => `${h.slice(0, h.lastIndexOf("_"))} as ${h}`).join(", ")} } from "react/jsx-runtime";\n${js}`;
        return { contents: js, loader: "js" };
      });
    },
  };
}

/** Browser bundles only: React's API, Preact's ~4 KB runtime. */
function preactAlias(root: string): BunPlugin {
  const map: Record<string, string> = {
    react: "preact/compat",
    "react-dom": "preact/compat",
    "react-dom/client": "preact/compat/client",
    "react/jsx-runtime": "preact/jsx-runtime",
    "react/jsx-dev-runtime": "preact/jsx-runtime",
  };
  return {
    name: "optz-preact",
    setup(build) {
      build.onResolve({ filter: /^react(-dom)?(\/client|\/jsx-runtime|\/jsx-dev-runtime)?$/ }, (args) => {
        const target = map[args.path];
        return target ? { path: Bun.resolveSync(target, root) } : undefined;
      });
    },
  };
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

const FRAMEWORK_CSS = "optz-island{display:contents}html.optz-navigating{cursor:progress}\n";

async function buildCss(root: string, config: ResolvedConfig, assetsDir: string, dev?: boolean): Promise<string[]> {
  const entry = join(root, config.css ?? "app/styles.css");
  let css: Buffer | string = FRAMEWORK_CSS;
  if (existsSync(entry)) {
    const cliPkg = Bun.resolveSync("@tailwindcss/cli/package.json", import.meta.dir);
    const pkg = JSON.parse(readFileSync(cliPkg, "utf8"));
    const bin = join(dirname(cliPkg), typeof pkg.bin === "string" ? pkg.bin : (Object.values(pkg.bin)[0] as string));
    const tmp = join(assetsDir, "styles.tmp.css");
    const p = Bun.spawnSync([process.execPath, bin, "-i", entry, "-o", tmp, ...(dev ? [] : ["--minify"])], { cwd: root, stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`tailwind failed:\n${p.stderr.toString()}`);
    appendFileSync(tmp, FRAMEWORK_CSS);
    css = readFileSync(tmp);
    rmSync(tmp);
  }
  const name = `styles-${hash(css)}.css`;
  writeFileSync(join(assetsDir, name), css);
  return [`/assets/${name}`];
}

export async function build({ root, config, dev, exportOnly }: BuildOptions): Promise<Manifest> {
  const t0 = performance.now();
  const routesDir = join(root, "app/routes");
  const out = outDirFor(root, dev);
  const staticDir = join(out, "static");
  const assetsDir = join(staticDir, "assets");
  const gen = join(root, ".optz/gen");
  const islandsMode = config.client.mode === "islands";
  if (islandsMode) registerIslandLoader(root);
  rmSync(out, { recursive: true, force: true });
  rmSync(gen, { recursive: true, force: true });
  mkdirSync(assetsDir, { recursive: true });
  mkdirSync(gen, { recursive: true });

  const table = scanRoutes(routesDir);
  const apis = config.features.api ? scanApi(join(root, "app/api")) : [];
  const pages = table.routes;
  writeTypes(root, pages, apis);
  const all = sortRoutes([...pages, ...apis]);

  const modes = new Map<Route, { render: RenderMode; hasLoader: boolean }>();
  for (const r of pages) {
    const mod = (await import(r.file)) as PageModule;
    if (typeof mod.default !== "function") throw new Error(`${rel(root, r.file)}: a page must export a default React component`);
    modes.set(r, { render: mod.config?.render ?? "static", hasLoader: typeof mod.loader === "function" });
  }
  const dynamic = pages.filter((r) => modes.get(r)!.render === "dynamic");
  if (dynamic.length && !config.features.dynamic) throw new Error(`features.dynamic is off, but these pages are dynamic:\n${dynamic.map((r) => `  ${r.pattern}`).join("\n")}`);
  if (exportOnly && (apis.length || dynamic.length)) {
    throw new Error(`optz export makes a static site, but these need a server:\n${[...apis.map((r) => `  ${r.pattern} (API route)`), ...dynamic.map((r) => `  ${r.pattern} (dynamic page)`)].join("\n")}`);
  }

  // ---- browser bundles ----
  const entryFile = join(gen, "entry.tsx");
  const plugins: BunPlugin[] = [];
  if (config.client.runtime === "preact") plugins.push(preactAlias(root));
  const preloadOf = new Map<Route, string[]>();
  const islands: Record<string, string> = {};
  let entrypoints: string[];
  let urlOf: (file: string) => string | undefined = () => undefined;

  if (islandsMode) {
    // A tiny entry (navigation + island loader) and one chunk per island. React is pulled in
    // by island chunks only, so pages without islands never download it.
    const files = walk(join(root, "app")).filter((f) => /\.island\.(tsx|jsx)$/.test(f));
    const wrappers: string[] = [];
    const lines: string[] = [];
    for (const [i, f] of files.entries()) {
      const mod = (await import(f)) as { hydrate?: Hydrate };
      const w = join(gen, `i${i}.tsx`);
      writeFileSync(w, `import C from ${JSON.stringify(f)};\nimport { hydrateIsland } from "optz/hydrate";\nexport default (el: Element, props: Record<string, unknown>, ctx: any) => hydrateIsland(el, C as any, props, ctx);\n`);
      wrappers.push(w);
      lines.push(`  ${JSON.stringify(islandId(root, f))}: { load: () => import("./i${i}.tsx"), hydrate: ${JSON.stringify(mod.hydrate ?? "load")} },`);
    }
    writeFileSync(entryFile, `import { startIslands } from "optz/islands";\nstartIslands({\n${lines.join("\n")}\n}, ${JSON.stringify({ navigation: config.client.navigation, prefetch: config.client.prefetch })});\n`);
    entrypoints = [entryFile, ...wrappers];
    const result = await bundle(entrypoints, assetsDir, dev, plugins);
    urlOf = (file) => outputUrl(result, assetsDir, file);
    files.forEach((f, i) => (islands[islandId(root, f)] = urlOf(wrappers[i])!));
  } else {
    // SPA: the whole page hydrates; one chunk per page and layout.
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
    writeFileSync(
      entryFile,
      `import { start } from "optz/runtime";\nstart([\n${pages
        .map((r, i) => {
          const m = modes.get(r)!;
          return `  { pattern: ${JSON.stringify(r.pattern)}, segments: ${JSON.stringify(r.segments)}, render: ${JSON.stringify(m.render)}, hasLoader: ${m.hasLoader}, load: ${imp(pageW[i])}, layouts: [${r.layouts.map((l) => imp(layoutW[layoutFiles.indexOf(l)])).join(", ")}]${r.error ? `, error: ${imp(errorW[errorFiles.indexOf(r.error)])}` : ""} },`;
        })
        .join("\n")}\n]);\n`,
    );
    entrypoints = [entryFile, ...pageW, ...layoutW, ...errorW];
    const result = await bundle(entrypoints, assetsDir, dev, [...plugins, stripServerExports(routesDir)]);
    urlOf = (file) => outputUrl(result, assetsDir, file);
    pages.forEach((r, i) => preloadOf.set(r, [urlOf(pageW[i]), ...r.layouts.map((l) => urlOf(layoutW[layoutFiles.indexOf(l)]))].filter(Boolean) as string[]));
  }
  const entryUrl = urlOf(entryFile)!;
  const css = await buildCss(root, config, assetsDir, dev);
  if (existsSync(join(root, "public"))) cpSync(join(root, "public"), staticDir, { recursive: true });

  const manifest: Manifest = {
    version: 2,
    mode: config.client.mode,
    entry: entryUrl,
    css,
    islands,
    routes: all.map((r) => ({
      pattern: r.pattern,
      segments: r.segments,
      file: rel(root, r.file),
      kind: r.kind,
      render: modes.get(r)?.render ?? "dynamic",
      hasLoader: modes.get(r)?.hasLoader ?? false,
      layouts: r.layouts.map((l) => rel(root, l)),
      error: r.error && rel(root, r.error),
      preload: preloadOf.get(r) ?? [],
    })),
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
      const assets = { entry: entryUrl, css, preload: mr.preload, islands };
      const base = { page, layouts, error, pattern: mr.pattern, segments: mr.segments, render: mr.render };
      if (mr.render === "client") {
        const r = await renderPage({ ...base, pathname: mr.pattern, params: {}, skipLoader: true, ctx: { url: new URL("http://build" + mr.pattern), locals: {} } }, assets, config);
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
        const r = await renderPage({ ...base, pathname, params, ctx: { url: new URL("http://build" + pathname), locals: {} } }, assets, config);
        if (r.kind === "notFound") continue;
        if (r.kind === "redirect") {
          const location = r.response.headers.get("Location") ?? "/";
          manifest.redirects[pathname] = { status: r.response.status, location };
          write(join(staticDir, dataPath(pathname)), JSON.stringify({ redirect: location }));
          continue;
        }
        write(join(staticDir, pathname === "/" ? "index.html" : `${pathname.slice(1)}/index.html`), r.html);
        if (!islandsMode) write(join(staticDir, dataPath(pathname)), JSON.stringify(r.payload));
        rendered++;
      }
    }
    if (manifest.notFound) {
      const page = await load<PageModule>(manifest.notFound);
      const layouts = await Promise.all(manifest.rootLayouts.map((l) => load<LayoutModule>(l)));
      const r = await renderPage({ page, layouts, pattern: "/_404", pathname: "/_404", params: {}, ctx: { url: new URL("http://build/_404"), locals: {} } }, { entry: entryUrl, css, preload: [], islands }, config);
      if (r.kind === "page") write(join(staticDir, "404.html"), r.html);
    }
    precompress(staticDir);
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
  const ms = Math.round(performance.now() - t0);
  console.log(
    `optz: built ${pages.length} pages, ${apis.length} API routes, ${Object.keys(islands).length} islands (${config.client.mode}, ${config.client.runtime})${dev ? "" : `, pre-rendered ${rendered}`} in ${ms} ms`,
  );
  return manifest;
}

async function bundle(entrypoints: string[], outdir: string, dev: boolean | undefined, plugins: BunPlugin[]) {
  const result = await Bun.build({
    entrypoints,
    outdir,
    target: "browser",
    format: "esm",
    splitting: true,
    minify: !dev,
    sourcemap: dev ? "inline" : "none",
    naming: { entry: "[name]-[hash].[ext]", chunk: "c-[hash].[ext]", asset: "[name]-[hash].[ext]" },
    define: { "process.env.NODE_ENV": JSON.stringify(dev ? "development" : "production") },
    plugins,
  });
  if (!result.success) throw new AggregateError(result.logs, "client build failed");
  return result;
}

function outputUrl(result: Awaited<ReturnType<typeof Bun.build>>, assetsDir: string, srcFile: string) {
  const base = srcFile.split("/").pop()!.replace(/\.tsx$/, "");
  const o = result.outputs.find((o) => o.kind === "entry-point" && o.path.split("/").pop()!.startsWith(`${base}-`));
  return o ? `/assets/${relative(assetsDir, o.path)}` : undefined;
}

function write(file: string, content: string | Uint8Array) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}
