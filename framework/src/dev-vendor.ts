// Dev only: React, ReactDOM and the Fast Refresh runtime in one bundle (/assets/dev-vendor/vendor.js),
// and a plugin that points every island's React import at it. A rebuilt island chunk then
// shares the page's React instance, so Fast Refresh can swap its code while keeping its state.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { BunPlugin } from "bun";

export const VENDOR_URL = "/assets/dev-vendor/vendor.js";

const SPECS: Record<string, string> = {
  react: "React",
  "react-dom": "ReactDOM",
  "react-dom/client": "ReactDOMClient",
  "react/jsx-dev-runtime": "JSXDev",
  "react/jsx-runtime": "JSX",
  // The framework's client runtime too: a rebuilt island chunk must not bring its own copy
  // (a new router context above the island would make React remount it).
  optz: "Optz",
  "optz/hydrate": "OptzHydrate",
  "optz/runtime": "OptzRuntime",
};

const ident = (n: string) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== "default";

export const REFRESH_URL = "/assets/dev-vendor/refresh.js";

export async function buildDevVendor(root: string, assetsDir: string) {
  const gen = join(root, ".optz/gen/vendor");
  mkdirSync(gen, { recursive: true });
  // Fast Refresh must hook into React before ReactDOM initializes: the dev entry imports this
  // module statically, so it runs before any island (and the vendor bundle) loads.
  writeFileSync(
    join(gen, "refresh.ts"),
    `import * as Refresh from "react-refresh/runtime";
Refresh.injectIntoGlobalHook(window);
(window as any).$RefreshReg$ = (type: unknown, id: string) => Refresh.register(type, id);
(window as any).$RefreshSig$ = Refresh.createSignatureFunctionForTransform;
export { Refresh };
`,
  );
  writeFileSync(
    join(gen, "vendor.ts"),
    `export { Refresh } from ${JSON.stringify(REFRESH_URL)};
${Object.entries(SPECS)
  .map(([spec, name]) => `import * as ${name} from ${JSON.stringify(spec)};`)
  .join("\n")}
export { ${Object.values(SPECS).join(", ")} };
`,
  );
  const result = await Bun.build({
    entrypoints: [join(gen, "refresh.ts"), join(gen, "vendor.ts")],
    outdir: join(assetsDir, "dev-vendor"),
    target: "browser",
    format: "esm",
    naming: "[name].[ext]",
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    plugins: [{ name: "optz-dev-vendor-external", setup: (b) => void b.onResolve({ filter: /^\/assets\/dev-vendor\// }, (x) => ({ path: x.path, external: true })) }],
  });
  if (!result.success) throw new AggregateError(result.logs, "dev vendor build failed");
}

/** Island bundles in dev: React imports become shims over the vendor bundle. */
export function vendorShims(root: string): BunPlugin {
  const req = createRequire(join(root, "package.json"));
  return {
    name: "optz-dev-vendor",
    setup(build) {
      build.onResolve({ filter: /^\/assets\/dev-vendor\// }, (a) => ({ path: a.path, external: true }));
      build.onResolve({ filter: /^(react(-dom)?(\/client|\/jsx-dev-runtime|\/jsx-runtime)?|optz(\/hydrate|\/runtime)?)$/ }, (a) => (SPECS[a.path] ? { path: a.path, namespace: "optz-vendor" } : undefined));
      build.onLoad({ filter: /.*/, namespace: "optz-vendor" }, (a) => {
        const names = Object.keys(req(a.path)).filter(ident);
        return { loader: "js", contents: `import { ${SPECS[a.path]} as M } from ${JSON.stringify(VENDOR_URL)};\nexport const { ${names.join(", ")} } = M;\nexport default M;\n` };
      });
    },
  };
}

/** Bun's Fast Refresh transform emits `const X = ...; var X = X` (a syntax error) for
 *  `export default function X` with hooks. Rewriting it as `function X` + `export default X`
 *  gives the same module, transformed correctly. Dev builds of project files only. */
export function refreshFix(root: string): BunPlugin {
  const app = join(root, "app") + "/";
  return {
    name: "optz-refresh-fix",
    setup(build) {
      build.onLoad({ filter: /\.(tsx|jsx)$/ }, async (a) => {
        if (!a.path.startsWith(app)) return undefined;
        const src = await Bun.file(a.path).text();
        const m = src.match(/^export default (async )?function ([A-Za-z_$][\w$]*)/m);
        if (!m) return undefined;
        return { loader: a.path.endsWith("x") ? "tsx" : "jsx", contents: `${src.replace(m[0], `${m[1] ?? ""}function ${m[2]}`)}\nexport default ${m[2]};\n` };
      });
    },
  };
}
