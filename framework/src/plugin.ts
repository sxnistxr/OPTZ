// Runtime plugin for the server process: wraps `*.island.tsx` default exports with island()
// so server rendering marks them for hydration. Browser bundles get the original file.
import { relative } from "node:path";

let registered = false;

export function islandId(root: string, file: string) {
  return relative(root, file).split("\\").join("/");
}

export function registerIslandLoader(root: string) {
  if (registered) return;
  registered = true;
  Bun.plugin({
    name: "optz-islands",
    setup(build) {
      build.onLoad({ filter: /\.island\.(tsx|jsx)$/ }, async (args) => {
        const src = await Bun.file(args.path).text();
        const id = islandId(root, args.path);
        if (!/^export default /m.test(src)) throw new Error(`${id}: an island needs a default export (the component)`);
        // `export default function X` -> `const __optz_default = function X` (a valid expression
        // for functions, classes and values), then export the wrapped component instead.
        const body = src.replace(/^export default /m, "const __optz_default = ");
        return {
          loader: args.path.endsWith("x") ? "tsx" : "jsx",
          contents: `${body}
import { island as __optz_island } from "optz/island";
export default __optz_island(${JSON.stringify(id)}, __optz_default, typeof hydrate === "string" ? hydrate : "load");
`,
        };
      });
    },
  });
}
