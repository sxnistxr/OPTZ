// File-system routes.
//
// Pages, in app/routes (.tsx/.jsx):
//   index.tsx            /             page
//   about.tsx            /about
//   blog/[slug].tsx      /blog/:slug   page with a parameter
//   docs/[...rest].tsx   /docs/*       catch-all (rest = "a/b/c")
//   (group)/x.tsx        /x            parenthesised folders group files without adding a segment
//   _layout.tsx          wraps every page in its folder and below
//   _error.tsx           shown when a page in its folder or below throws
//   _404.tsx             the not-found page (top level only)
// Files and folders starting with "_" are never routes; .ts files next to pages are ignored
// (helpers), so pages and API routes stay separate.
//
// API routes, in app/api (.ts/.js), mounted under /api with the same [param] rules:
//   app/api/stats.ts        /api/stats          exports GET, POST, ... (and optionally `cache`)
//   app/api/posts/[id].ts   /api/posts/:id
import { existsSync, readdirSync, statSync } from "node:fs";
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
const skip = (e: string) => e.startsWith("_") || e.endsWith(".d.ts") || /\.(test|spec)\./.test(e);

function toSegments(rel: string[]): Segment[] {
  return rel
    .filter((s) => !/^\(.*\)$/.test(s))
    .map((s): Segment => {
      let m = s.match(/^\[\.\.\.(\w+)\]$/);
      if (m) return { kind: "rest", name: m[1] };
      m = s.match(/^\[(\w+)\]$/);
      if (m) return { kind: "param", name: m[1] };
      return { kind: "static", value: s };
    });
}

const patternOf = (segments: Segment[]) =>
  "/" + segments.map((s) => (s.kind === "static" ? s.value : s.kind === "param" ? `[${s.name}]` : `[...${s.name}]`)).join("/");

function relSegments(base: string, file: string, ext: RegExp): string[] {
  const rel = relative(base, file).split(sep);
  rel[rel.length - 1] = rel[rel.length - 1].replace(ext, "");
  if (rel[rel.length - 1] === "index") rel.pop();
  return rel;
}

/** Most specific first: static segments beat params, params beat catch-alls, longer beats
 *  shorter. Two files answering the same URLs are an error. */
export function sortRoutes<R extends { segments: Segment[]; file: string }>(routes: R[]): R[] {
  const rank = (r: R) => r.segments.map((s) => (s.kind === "static" ? "0" : s.kind === "param" ? "1" : "2")).join("") + "3";
  routes.sort((a, b) => rank(a).localeCompare(rank(b)) || b.segments.length - a.segments.length);
  const seen = new Map<string, string>();
  for (const r of routes) {
    const key = r.segments.map((s) => (s.kind === "static" ? s.value : s.kind === "param" ? ":" : "*")).join("/");
    if (seen.has(key)) throw new Error(`Two routes match the same URLs: ${seen.get(key)} and ${r.file}`);
    seen.set(key, r.file);
  }
  return routes;
}

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
      if (skip(e) || !PAGE.test(e)) continue;
      const segments = toSegments(relSegments(routesDir, full, PAGE));
      routes.push({ pattern: patternOf(segments), segments, file: full, kind: "page", layouts: here, error: errHere });
    }
  };
  walk(routesDir, [], undefined);
  sortRoutes(routes);
  const rootLayout = readdirSync(routesDir).find((e) => /^_layout\.(tsx|jsx)$/.test(e));
  return { routes, notFound, rootLayouts: rootLayout ? [join(routesDir, rootLayout)] : [] };
}

/** API routes: every .ts/.js file under `apiDir`, mounted under `prefix`. */
export function scanApi(apiDir: string, prefix = "/api"): Route[] {
  const out: Route[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir).sort()) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) {
        if (!e.startsWith("_")) walk(full);
        continue;
      }
      if (skip(e) || !API.test(e)) continue;
      const segments = [...toSegments(prefix.split("/").filter(Boolean)), ...toSegments(relSegments(apiDir, full, API))];
      out.push({ pattern: patternOf(segments), segments, file: full, kind: "api", layouts: [] });
    }
  };
  if (existsSync(apiDir)) walk(apiDir);
  return out;
}
