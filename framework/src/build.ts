import { codeLiteral } from "./code-literal";
// `optz build`: everything a production server (or a plain static host) needs, in dist/.
//
//   dist/static/            servable as-is: pre-rendered pages (path/index.html), their data
//                           (/_optz/data/*.json, SPA mode), hashed assets (/assets/*),
//                           public/ files, and .gz/.br next to every text file
//   dist/manifest.json      routes, render modes, chunks and redirects, for `optz start`
import { brotliCompressSync, constants as zc, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { BunPlugin } from "bun";
import { writeTypes } from "./codegen";
import { outDirFor, type Manifest, type ManifestRoute } from "./manifest";
export { outDirFor, type Manifest, type ManifestRoute };
import { actionStubs, scanActions } from "./actions";
import { createApp } from "./handler";
import { apiStaticPath, htmlPath, ogPath, type ManifestSlot } from "./manifest";
import { islandId, registerIslandLoader } from "./plugin";
import { dataPath, fillPattern, scanApi, scanMcp, scanRoutes, sortRoutes, type Route } from "./routes";
import { bunPlatform } from "./server";
import type { ApiModule, Hydrate, PageModule, RenderMode, ResolvedConfig } from "./types";

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

const FRAMEWORK_CSS =
  "optz-island,optz-script{display:contents}html.optz-navigating{cursor:progress}" +
  // Cross-document view transitions: a short cross-fade between pages (Chromium, Safari 18.2+).
  // Only with scripting on: with JavaScript disabled, Chromium never finishes the transition and
  // the page stops taking clicks.
  "@media (scripting:enabled){@view-transition{navigation:auto}}::view-transition-old(root),::view-transition-new(root){animation-duration:.16s}" +
  "@media (prefers-reduced-motion:reduce){::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important}}" +
  ".optz-img{max-width:100%;height:auto}.optz-img-fill{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}" +
  // Navigation moves focus to <main> (tabindex=-1) for screen readers: no ring for that.
  "[tabindex='-1']:focus:not(:focus-visible){outline:none}" +
  ".optz-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}\n";

/** Build tools are optional peers: found in the project, else next to optz, else a clear error. */
export function resolvePeer(spec: string, root: string, what: string, install: string): string {
  for (const from of [root, import.meta.dir]) {
    try {
      return Bun.resolveSync(spec, from);
    } catch {}
  }
  throw new Error(`optz: ${what} needs ${install.split(" ")[0]}. Install it: bun add -d ${install}`);
}

async function buildCss(root: string, config: ResolvedConfig, assetsDir: string, dev?: boolean, extra = ""): Promise<string[]> {
  const entry = join(root, config.css ?? "app/styles.css");
  let css: Buffer | string = FRAMEWORK_CSS + extra;
  if (existsSync(entry)) {
    const cliPkg = resolvePeer("@tailwindcss/cli/package.json", root, `${config.css ?? "app/styles.css"} (Tailwind CSS)`, "tailwindcss @tailwindcss/cli");
    const pkg = JSON.parse(readFileSync(cliPkg, "utf8"));
    const bin = join(dirname(cliPkg), typeof pkg.bin === "string" ? pkg.bin : (Object.values(pkg.bin)[0] as string));
    const tmp = join(assetsDir, "styles.tmp.css");
    const p = Bun.spawnSync([process.execPath, bin, "-i", entry, "-o", tmp, ...(dev ? [] : ["--minify"])], { cwd: root, stderr: "pipe" });
    if (p.exitCode !== 0) throw new Error(`tailwind failed:\n${p.stderr.toString()}`);
    appendFileSync(tmp, FRAMEWORK_CSS + extra);
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
  // Production builds go to dist.next and replace dist only when everything succeeded, so a
  // failed build leaves the last good one in place (and a running server's files untouched).
  const final = outDirFor(root, dev);
  const out = dev ? final : `${final}.next`;
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
  const actions = config.features.actions ? scanActions(root) : {};
  const mcpFiles = config.features.mcp ? scanMcp(root) : [];
  // Load them now so a broken definition fails the build, not the first AI client.
  let mcpCounts = { tools: 0, prompts: 0, resources: 0 };
  if (mcpFiles.length) {
    const { createMcpServer } = await import("./mcp");
    const s = createMcpServer({ config, modules: await Promise.all(mcpFiles.map(async (file) => ({ file, mod: await import(join(root, file)) }))) });
    mcpCounts = { tools: s.tools.size, prompts: s.prompts.size, resources: s.resources.length };
  }
  if (!islandsMode && (table.slots.length || table.intercepts.length)) throw new Error("parallel and intercepting routes need client.mode \"islands\"");
  // Prerendered pages arrive by real navigation, which can't keep parallel slots or open an
  // intercepted route in place, so apps with either keep the HTML-swap navigation.
  const speculate = islandsMode && config.client.speculation && !dev && !table.slots.length && !table.intercepts.length;

  interface Mode {
    render: RenderMode;
    hasLoader: boolean;
    revalidate?: number;
    dynamicParams?: boolean;
    tags?: string[];
  }
  const modes = new Map<Route, Mode>();
  const modeOf = async (r: Route): Promise<Mode> => {
    const mod = (await import(r.file)) as PageModule;
    if (typeof mod.default !== "function") throw new Error(`${rel(root, r.file)}: a page must export a default React component`);
    return { render: mod.config?.render ?? "static", hasLoader: typeof mod.loader === "function", revalidate: mod.revalidate, dynamicParams: mod.dynamicParams, tags: mod.tags };
  };
  for (const r of [...pages, ...table.intercepts, ...table.slots.flatMap((s) => [...s.routes, ...s.intercepts])]) modes.set(r, await modeOf(r));
  const apiMods = new Map<Route, ApiModule>();
  for (const r of apis) apiMods.set(r, (await import(r.file)) as ApiModule);
  const dynamic = pages.filter((r) => modes.get(r)!.render === "dynamic" || modes.get(r)!.revalidate !== undefined || modes.get(r)!.dynamicParams);
  if (dynamic.length && !config.features.dynamic) {
    throw new Error(`features.dynamic is off, but these pages render at request time (dynamic, revalidate or dynamicParams):\n${dynamic.map((r) => `  ${r.pattern}`).join("\n")}`);
  }
  if (exportOnly) {
    const needServer = [
      ...apis.filter((r) => !apiMods.get(r)!.prerender).map((r) => `  ${r.pattern} (API route)`),
      ...dynamic.map((r) => `  ${r.pattern} (rendered at request time)`),
      ...Object.values(actions).map((a) => `  ${a.file} (Server Actions)`),
      ...mcpFiles.map((f) => `  ${f} (MCP)`),
    ];
    if (needServer.length) throw new Error(`optz export makes a static site, but these need a server:\n${needServer.join("\n")}`);
  }

  // ---- browser bundles ----
  const entryFile = join(gen, "entry.tsx");
  const plugins: BunPlugin[] = [actionStubs(root, actions)];
  // Dev (islands): React from one vendor bundle, so Fast Refresh can hot-swap island code.
  const hot = !!dev && islandsMode;
  if (hot) {
    const { buildDevVendor, refreshFix, vendorShims } = await import("./dev-vendor");
    await buildDevVendor(root, assetsDir);
    plugins.push(vendorShims(root), refreshFix(root));
  } else if (config.client.runtime === "preact") plugins.push(preactAlias(root));
  const preloadOf = new Map<Route, string[]>();
  const islands: Record<string, string> = {};
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
      writeFileSync(w, `import C from ${codeLiteral(f)};\nimport { hydrateIsland } from "optz/hydrate";\nexport default (el: Element, props: Record<string, unknown>, ctx: any) => hydrateIsland(el, C as any, props, ctx);\n`);
      wrappers.push(w);
      lines.push(`  ${codeLiteral(islandId(root, f))}: { load: () => import("./i${i}.tsx"), hydrate: ${codeLiteral(mod.hydrate ?? "load")} },`);
    }
    // Speculation rules (dev: off, so edits are never served from a stale prerender).
    const speculation = speculate;
    writeFileSync(entryFile, `${hot ? 'import "/assets/dev-vendor/refresh.js";\n' : ""}import { startIslands } from "optz/islands";\nstartIslands({\n${lines.join("\n")}\n}, ${codeLiteral({ navigation: config.client.navigation, prefetch: config.client.prefetch, speculation })});\n`);
    const result = await bundle([entryFile, ...wrappers], assetsDir, dev, plugins, hot, config);
    urlOf = (file) => outputUrl(result, assetsDir, file);
    files.forEach((f, i) => (islands[islandId(root, f)] = urlOf(wrappers[i])!));
  } else {
    // SPA: the whole page hydrates; one chunk per page and layout.
    const layoutFiles = [...new Set(pages.flatMap((r) => r.layouts))];
    const errorFiles = [...new Set(pages.flatMap((r) => (r.error ? [r.error] : [])))];
    const wrapper = (name: string, file: string) => {
      const p = join(gen, `${name}.tsx`);
      writeFileSync(p, `export * from ${codeLiteral(file)};\nexport { default } from ${codeLiteral(file)};\n`);
      return p;
    };
    const pageW = pages.map((r, i) => wrapper(`p${i}`, r.file));
    const layoutW = layoutFiles.map((f, i) => wrapper(`l${i}`, f));
    const errorW = errorFiles.map((f, i) => wrapper(`e${i}`, f));
    const imp = (p: string) => `() => import(${codeLiteral("./" + relative(gen, p))})`;
    const i18n = config.i18n ? { locales: config.i18n.locales, defaultLocale: config.i18n.defaultLocale, prefixDefault: config.i18n.prefixDefault } : undefined;
    writeFileSync(
      entryFile,
      `import { start } from "optz/runtime";\nstart([\n${pages
        .map((r, i) => {
          const m = modes.get(r)!;
          return `  { pattern: ${codeLiteral(r.pattern)}, segments: ${codeLiteral(r.segments)}, render: ${codeLiteral(m.render === "static" && (m.revalidate !== undefined || m.dynamicParams) ? "dynamic" : m.render)}, hasLoader: ${m.hasLoader}, load: ${imp(pageW[i])}, layouts: [${r.layouts.map((l) => imp(layoutW[layoutFiles.indexOf(l)])).join(", ")}]${r.error ? `, error: ${imp(errorW[errorFiles.indexOf(r.error)])}` : ""} },`;
        })
        .join("\n")}\n], ${codeLiteral(i18n ?? null)});\n`,
    );
    const result = await bundle([entryFile, ...pageW, ...layoutW, ...errorW], assetsDir, dev, [...plugins, stripServerExports(routesDir)], false, config);
    urlOf = (file) => outputUrl(result, assetsDir, file);
    pages.forEach((r, i) => preloadOf.set(r, [urlOf(pageW[i]), ...r.layouts.map((l) => urlOf(layoutW[layoutFiles.indexOf(l)]))].filter(Boolean) as string[]));
  }
  const entryUrl = urlOf(entryFile)!;
  const fonts = config.fonts?.length && !dev ? await (await import("./fonts")).buildFonts(config.fonts, assetsDir) : { css: "", preload: [] as string[] };
  const css = await buildCss(root, config, assetsDir, dev, fonts.css);
  if (existsSync(join(root, "public"))) cpSync(join(root, "public"), staticDir, { recursive: true });
  if (speculate) {
    // Prerender same-site pages when a link is hovered or pressed (Chromium). Served as a file
    // named by the Speculation-Rules response header: no inline script, so CSP stays strict.
    write(join(staticDir, "_optz/speculation.json"), JSON.stringify({
      prerender: [{ where: { and: [{ href_matches: "/*" }, { not: { href_matches: ["/api/*", "/_optz/*"] } }, { not: { selector_matches: "[data-reload], [download], [target=_blank]" } }] }, eagerness: "moderate" }],
    }));
  }

  const toManifest = (r: Route): ManifestRoute => {
    const m = modes.get(r);
    const api = apiMods.get(r);
    return {
      pattern: r.pattern,
      segments: r.segments,
      file: rel(root, r.file),
      kind: r.kind,
      render: m?.render ?? "dynamic",
      hasLoader: m?.hasLoader ?? false,
      layouts: r.layouts.map((l) => rel(root, l)),
      error: r.error && rel(root, r.error),
      loading: r.loading && rel(root, r.loading),
      og: r.og && rel(root, r.og),
      preload: preloadOf.get(r) ?? [],
      revalidate: m?.revalidate ?? api?.revalidate,
      dynamicParams: m?.dynamicParams,
      tags: m?.tags ?? api?.tags,
      prerendered: api?.prerender || undefined,
      scope: r.scope,
    };
  };
  const manifest: Manifest = {
    version: 3,
    builtAt: Date.now(),
    mode: config.client.mode,
    entry: entryUrl,
    css,
    islands,
    routes: all.map(toManifest),
    notFound: table.notFound && rel(root, table.notFound),
    rootLayouts: table.rootLayouts.map((l) => rel(root, l)),
    redirects: {},
    slots: table.slots.map(
      (s): ManifestSlot => ({ name: s.name, layout: rel(root, s.layout), routes: s.routes.map(toManifest), intercepts: s.intercepts.map(toManifest), default: s.default && rel(root, s.default) }),
    ),
    intercepts: table.intercepts.map(toManifest),
    actions,
    fonts: fonts.preload,
    apiStatic: {},
    ...(mcpFiles.length ? { mcp: mcpFiles } : {}),
  };

  // ---- pre-render static pages, client shells, API routes and OG images (production only) ----
  // Rendered through the same handler that serves requests, so what's built is exactly what a
  // request would have produced.
  let rendered = 0;
  if (!dev) {
    const platform = bunPlatform(root, config);
    const app = await createApp({ manifest, config: { ...config, features: { ...config.features, cache: false } }, files: new Map(), platform, prerender: true });
    const get = async (path: string, headers: Record<string, string> = {}) => app.fetch(new Request("http://build" + path, { headers }));
    const locales = config.i18n?.locales ?? [undefined];
    const localized = (path: string, l?: string) =>
      !l || !config.i18n || (l === config.i18n.defaultLocale && !config.i18n.prefixDefault) ? path : `/${l}${path === "/" ? "" : path}`;

    for (const mr of manifest.routes) {
      const page = mr.kind === "page" ? await import(join(root, mr.file)) as PageModule : null;
      if (mr.kind === "api") {
        const mod = apiMods.get(all.find((r) => rel(root, r.file) === mr.file)!)!;
        if (!mod.prerender) continue;
        const hasParams = mr.segments.some((s) => s.kind !== "static");
        if (hasParams && !mod.paths) throw new Error(`${mr.file}: a prerendered API route with parameters needs \`export function paths()\``);
        for (const params of hasParams ? await mod.paths!() : [{}]) {
          const path = fillPattern(mr.segments, params);
          const res = await get(path);
          if (res.status !== 200) throw new Error(`${mr.file}: GET ${path} answered ${res.status} at build time`);
          write(join(staticDir, apiStaticPath(path)), new Uint8Array(await res.arrayBuffer()));
          manifest.apiStatic[path] = { file: apiStaticPath(path), type: res.headers.get("content-type") ?? "application/json" };
          rendered++;
        }
        continue;
      }
      if (!page || mr.render === "dynamic") continue;
      if (mr.render === "client") {
        mr.shell = `/_optz/shells/${hash(mr.pattern)}.html`;
        const res = await get(mr.pattern.replace(/\[\[?\.{0,3}(\w+)\]?\]/g, "_$1_"));
        if (res.status !== 200) throw new Error(`${mr.file}: rendering its shell failed (${res.status})`);
        write(join(staticDir, mr.shell), await res.text());
        rendered++;
        continue;
      }
      const needsPaths = mr.segments.some((s) => s.kind === "param" || s.kind === "rest");
      if (needsPaths && !page.paths && !mr.dynamicParams) {
        throw new Error(`${mr.file}: a static page with parameters needs \`export function paths()\` (or \`export const dynamicParams = true\`, or \`export const config = { render: "dynamic" }\`)`);
      }
      for (const locale of locales) {
        const sets = page.paths ? await page.paths({ locale }) : needsPaths ? [] : [{}];
        const one = async (params: Record<string, string>) => {
          const path = localized(fillPattern(mr.segments, params), locale);
          const res = await get(path);
          if (res.status >= 300 && res.status < 400) {
            const location = res.headers.get("Location") ?? "/";
            manifest.redirects[path] = { status: res.status, location };
            write(join(staticDir, dataPath(path)), JSON.stringify({ redirect: location }));
            return;
          }
          if (res.status >= 500) throw new Error(`${mr.file}: rendering ${path} failed (see the error above)`);
          if (res.status !== 200) return;
          write(join(staticDir, htmlPath(path)), await res.text());
          if (!islandsMode) {
            const d = await get(dataPath(path));
            if (d.status === 200) write(join(staticDir, dataPath(path)), await d.text());
          }
          if (mr.og) {
            const og = await get(ogPath(path));
            if (og.status === 200) write(join(staticDir, ogPath(path)), new Uint8Array(await og.arrayBuffer()));
          }
          rendered++;
        };
        // A few at a time: loaders that wait on I/O (a CMS, a database) overlap.
        for (let i = 0; i < sets.length; i += PRERENDER_CONCURRENCY) await Promise.all(sets.slice(i, i + PRERENDER_CONCURRENCY).map(one));
      }
    }
    if (manifest.notFound) {
      for (const locale of locales) {
        const res = await get(`/_optz/404${locale ? `?locale=${locale}` : ""}`);
        const file = locale && localized("/", locale) !== "/" ? `${locale}/404.html` : "404.html";
        if (res.status === 404 && (res.headers.get("content-type") ?? "").includes("html")) write(join(staticDir, file), await res.text());
      }
    }
    const { buildSeoFiles } = await import("./seo");
    rendered += await buildSeoFiles(root, config, staticDir);
    const { buildLlmsFiles } = await import("./llms");
    rendered += await buildLlmsFiles(root, config, staticDir);
    // Static hosts never read the manifest: redirects become a page that forwards (any host)
    // and a _redirects file (Netlify, Cloudflare Pages).
    const redirects = Object.entries(manifest.redirects);
    if (exportOnly && redirects.length) {
      const esc = (u: string) => u.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
      for (const [from, r] of redirects) {
        write(
          join(staticDir, htmlPath(from)),
          `<!doctype html><meta charset="utf-8"><title>Moved</title><meta http-equiv="refresh" content="0; url=${esc(r.location)}"><link rel="canonical" href="${esc(r.location)}"><p><a href="${esc(r.location)}">Moved here</a></p>\n`,
        );
      }
      appendFileSync(join(staticDir, "_redirects"), redirects.map(([from, r]) => `${from} ${r.location} ${r.status === 308 ? 301 : r.status === 307 ? 302 : r.status}`).join("\n") + "\n");
      console.log(`optz: ${redirects.length} redirect${redirects.length === 1 ? "" : "s"} as forwarding pages and _redirects:\n${redirects.map(([f, r]) => `  ${f} -> ${r.location} (${r.status})`).join("\n")}`);
    }
    precompress(staticDir);
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 1));
  if (out !== final) {
    const old = `${final}.old`;
    rmSync(old, { recursive: true, force: true });
    if (existsSync(final)) renameSync(final, old);
    renameSync(out, final);
    rmSync(old, { recursive: true, force: true });
  }
  const ms = Math.round(performance.now() - t0);
  const extras = [
    Object.keys(actions).length && `${Object.values(actions).reduce((n, a) => n + a.exports.length, 0)} actions`,
    table.slots.length && `${table.slots.length} slots`,
    fonts.preload.length && `${fonts.preload.length} fonts`,
    mcpFiles.length &&
      `MCP ${Object.entries(mcpCounts)
        .filter(([, n]) => n)
        .map(([k, n]) => `${n} ${n === 1 ? k.slice(0, -1) : k}`)
        .join(", ")}`,
  ].filter(Boolean);
  console.log(
    `optz: built ${pages.length} pages, ${apis.length} API routes, ${Object.keys(islands).length} islands${extras.length ? ", " + extras.join(", ") : ""} (${config.client.mode}, ${config.client.runtime})${dev ? "" : `, pre-rendered ${rendered}`} in ${ms} ms`,
  );
  return manifest;
}

/** Pages of one route pre-rendered at the same time. */
const PRERENDER_CONCURRENCY = 8;

async function bundle(entrypoints: string[], outdir: string, dev: boolean | undefined, plugins: BunPlugin[], reactFastRefresh = false, config?: ResolvedConfig) {
  const result = await Bun.build({
    reactFastRefresh,
    entrypoints,
    outdir,
    target: "browser",
    format: "esm",
    splitting: true,
    minify: !dev,
    sourcemap: dev ? "inline" : "none",
    naming: { entry: "[name]-[hash].[ext]", chunk: "c-[hash].[ext]", asset: "[name]-[hash].[ext]" },
    define: {
      "process.env.NODE_ENV": codeLiteral(dev ? "development" : "production"),
      // <Image> in islands offers the same widths the optimizer produces.
      ...(config?.images?.sizes ? { "globalThis.__OPTZ_IMAGE_SIZES__": codeLiteral(config.images.sizes) } : {}),
    },
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
