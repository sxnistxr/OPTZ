import type { BunPlugin } from "bun";
/** Browser builds must fail before a secret-bearing server module can enter the graph. */
export function serverBoundaries(actionFiles: Set<string> = new Set()): BunPlugin {
  return {
    name: "optz-server-boundaries",
    setup(build) {
      build.onResolve({ filter: /^optz\/(server|server-only|sessions|sqlite|storage)$/ }, args => { throw new Error(`Server-only import ${args.path} in browser code (${args.importer})`); });
      build.onLoad({ filter: /\.server\.[cm]?[jt]sx?$|[/\\]app[/\\]lib[/\\]server[/\\]/ }, args => {
        if (!actionFiles.has(args.path)) throw new Error(`Server-only module reached a browser bundle: ${args.path}`);
        return undefined;
      });
    },
  };
}
