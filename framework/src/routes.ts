// File-system routes. In app/routes:
//   index.tsx            /             page (React component)
//   about.tsx            /about        page
//   blog/[slug].tsx      /blog/:slug   page with a parameter
//   docs/[...rest].tsx   /docs/*       catch-all (rest = "a/b/c")
//   (group)/x.tsx        /x            parenthesised folders group files without adding a segment
//   hello.ts             /hello        API route: exports GET, POST, ...
//   _layout.tsx          wraps every page in its folder and below
//   _error.tsx           shown when a page in its folder or below throws
//   _404.tsx             the not-found page (top level only)
// Files and folders starting with "_" are never routes.
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Segment } from "./match";
export * from "./match";

export interface Route {
  /** e.g. "/blog/[slug]" */
  pattern: string;
  segments: Segment[];
  file: string;
  kind: "page" | "api";
  /** Layout files from outermost to innermost. */
  layouts: string[];
  /** Nearest error boundary file, if any. */
  error?: string;
}

export interface RouteTable {
  routes: Route[];
  notFound?: string;
  rootLayouts: string[];
}

const PAGE = /\.(tsx|jsx)$/;
const API = /\.(ts|js)$/;

export function scanRoutes(routesDir: string): RouteTable {
  const routes: Route[] = [];
  let notFound: string | undefined;

  const walk = (dir: string, layouts: string[], error: string | undefined) => {
    const entries = readdirSync(dir).sort();
    const layout = entries.find((e) => /^_layout\.(tsx|jsx)$/.test(e));
    const err = entries.find((e) => /^_error\.(tsx|jsx)$/.test(e));
    const here = layout ? [...layouts, join(dir, layout)] : layouts;
    const errHere = err ? join(dir, err) : error;
    for (const e of entries) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) {
        if (!e.startsWith("_")) walk(full, here, errHere);
        continue;
      }
      if (/^_404\.(tsx|jsx)$/.test(e) && dir === routesDir) notFound = full;
      if (e.startsWith("_") || e.endsWith(".d.ts") || /\.(test|spec)\./.test(e)) continue;
      const kind = PAGE.test(e) ? "page" : API.test(e) ? "api" : null;
      if (!kind) continue;
      const rel = relative(routesDir, full).split(sep);
      rel[rel.length - 1] = rel[rel.length - 1].replace(/\.(tsx|jsx|ts|js)$/, "");
      if (rel[rel.length - 1] === "index") rel.pop();
      const segments: Segment[] = rel
        .filter((s) => !/^\(.*\)$/.test(s))
        .map((s) => {
          let m = s.match(/^\[\.\.\.(\w+)\]$/);
          if (m) return { kind: "rest", name: m[1] };
          m = s.match(/^\[(\w+)\]$/);
          if (m) return { kind: "param", name: m[1] };
          return { kind: "static", value: s };
        });
      const pattern = "/" + segments.map((s) => (s.kind === "static" ? s.value : s.kind === "param" ? `[${s.name}]` : `[...${s.name}]`)).join("/");
      routes.push({ pattern, segments, file: full, kind, layouts: kind === "page" ? here : [], error: kind === "page" ? errHere : undefined });
    }
  };
  walk(routesDir, [], undefined);

  // Most specific first: static segments beat params, params beat catch-alls, longer beats shorter.
  const rank = (r: Route) => r.segments.map((s) => (s.kind === "static" ? "0" : s.kind === "param" ? "1" : "2")).join("") + "3";
  routes.sort((a, b) => rank(a).localeCompare(rank(b)) || b.segments.length - a.segments.length);

  const seen = new Map<string, string>();
  for (const r of routes) {
    const key = r.segments.map((s) => (s.kind === "static" ? s.value : s.kind === "param" ? ":" : "*")).join("/");
    if (seen.has(key)) throw new Error(`Two routes match the same URLs: ${seen.get(key)} and ${r.file}`);
    seen.set(key, r.file);
  }
  const rootLayout = readdirSync(routesDir).find((e) => /^_layout\.(tsx|jsx)$/.test(e));
  return { routes, notFound, rootLayouts: rootLayout ? [join(routesDir, rootLayout)] : [] };
}

