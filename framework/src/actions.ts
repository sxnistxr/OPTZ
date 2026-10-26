// Server Actions: modules that start with "use server" export async functions the browser can
// call. In browser bundles each export becomes a stub that POSTs its arguments to
// /_optz/action/<id>/<name>; on the server the real function runs. Types come from the real
// module, so a call with the wrong arguments is a compile error.
//
// They also work without JavaScript: <form action={saveNote}> rendered on the server posts to
// the same URL, and the server redirects back when the action finishes.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { BunPlugin } from "bun";

import type { ActionModule } from "./actions-runtime";
export * from "./actions-runtime";

const DIRECTIVE = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use server["']/;

export const isActionSource = (src: string) => DIRECTIVE.test(src);
export const actionId = (relFile: string) => createHash("sha256").update(relFile).digest("hex").slice(0, 12);

/** Every "use server" module under app/, keyed by id. */
export function scanActions(root: string): Record<string, ActionModule> {
  const out: Record<string, ActionModule> = {};
  const scanner = new Bun.Transpiler({ loader: "tsx" });
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir).sort()) {
      const f = join(dir, e);
      if (statSync(f).isDirectory()) {
        if (e !== "node_modules") walk(f);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx)$/.test(e) || e.endsWith(".d.ts")) continue;
      const src = readFileSync(f, "utf8");
      if (!isActionSource(src)) continue;
      const rel = relative(root, f).split("\\").join("/");
      const exports = scanner.scan(src).exports;
      out[actionId(rel)] = { file: rel, exports };
    }
  };
  walk(join(root, "app"));
  return out;
}

/** Browser bundles: replace "use server" modules with stubs. */
export function actionStubs(root: string, actions: Record<string, ActionModule>): BunPlugin {
  const byFile = new Map(Object.entries(actions).map(([id, a]) => [join(root, a.file), { id, ...a }]));
  return {
    name: "optz-actions",
    setup(build) {
      build.onLoad({ filter: /\.(ts|tsx|js|jsx)$/ }, (args) => {
        const a = byFile.get(args.path);
        if (!a) return undefined;
        const lines = a.exports.map((n) =>
          n === "default" ? `export default createAction(${JSON.stringify(a.id)}, "default");` : `export const ${n} = createAction(${JSON.stringify(a.id)}, ${JSON.stringify(n)});`,
        );
        return { loader: "js", contents: `import { createAction } from "optz/action-client";\n${lines.join("\n")}\n` };
      });
    },
  };
}

