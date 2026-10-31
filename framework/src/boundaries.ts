import type { BunPlugin } from "bun";
/** Browser builds must fail before a secret-bearing server module can enter the graph. */
export function serverBoundaries(actionFiles: Set<string> = new Set()): BunPlugin {
  return {
    name: "optz-server-boundaries",
    setup(build) {
      build.onResolve({ filter: /^optz\/(server|server-only|sessions|sqlite|storage|env|cdn)$/ }, args => { throw new Error(`Server-only import ${args.path} in browser code (${args.importer})`); });
      build.onResolve({ filter: /^@sxnistxr\/optz-auth(?:\/(?:sqlite|plugins|delivery))?$/ }, args => { throw new Error(`Server-only import ${args.path} in browser code (${args.importer}); use @sxnistxr/optz-auth/client`); });
      build.onResolve({ filter: /^@sxnistxr\/optz-(?:uploads(?:\/(?:s3|sqlite))?|analytics(?:\/(?:sqlite|posthog))?|status(?:\/sqlite)?|db)$/ }, args => { throw new Error(`Server-only import ${args.path} in browser code (${args.importer}); use an explicit client/view export`); });
      build.onLoad({ filter: /\.server\.[cm]?[jt]sx?$|[/\\]app[/\\]lib[/\\]server[/\\]/ }, args => {
        if (!actionFiles.has(args.path)) throw new Error(`Server-only module reached a browser bundle: ${args.path}`);
        return undefined;
      });
    },
  };
}
