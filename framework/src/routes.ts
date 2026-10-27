// File-system routes.
//
// Pages, in app/routes (.tsx/.jsx):
//   index.tsx              /              page
//   about.tsx              /about
//   blog/[slug].tsx        /blog/:slug    page with a parameter
//   docs/[...rest].tsx     /docs/*        catch-all, one or more segments (rest = "a/b/c")
//   shop/[[...path]].tsx   /shop, /shop/* optional catch-all, zero or more segments
//   (group)/x.tsx          /x             parenthesised folders group files without adding a segment
//   _layout.tsx            wraps every page in its folder and below
//   _error.tsx             shown when a page in its folder or below throws
//   _loading.tsx           shown while a streamed page in its folder or below is still rendering
//   _404.tsx               the not-found page (top level only)
//   about.og.tsx           the Open Graph image of about.tsx (rendered to PNG)
//
// Parallel routes: a folder named @name next to a _layout.tsx is a slot. The layout receives
// it as a prop (`name`), rendered from the file in @name that matches the same URL, or from
// @name/default.tsx when none does.
//
// Intercepting routes: a folder named (.)x, (..)x, (..)(..)x or (...)x answers the URL x at
// the same level, one or two levels up, or from the root, but only for in-app navigation
// that starts inside the folder holding it (a full page load shows the real page). Put one
// inside a slot to show it in that slot, e.g. a photo in a modal over the feed:
//   feed/_layout.tsx  feed/@modal/default.tsx  feed/@modal/(.)photo/[id].tsx  feed/photo/[id].tsx
//
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
  /** Nearest loading file, if any. */
  loading?: string;
  /** Open Graph image component for this page (`*.og.tsx`). */
  og?: string;
  /** Intercepting routes: navigation must start at a URL under this pattern. */
  scope?: Segment[];
}

/** A parallel route slot (`@name` folder) and what it can show. */
export interface Slot {
  name: string;
  /** The layout that receives it as a prop. */
  layout: string;
  routes: Route[];
  /** Intercepting routes inside the slot (in-app navigation only). */
  intercepts: Route[];
  default?: string;
}

export interface RouteTable {
  routes: Route[];
  notFound?: string;
  rootLayouts: string[];
  slots: Slot[];
  /** Intercepting routes outside slots: they replace the page during in-app navigation. */
  intercepts: Route[];
}

const PAGE = /\.(tsx|jsx)$/;
const API = /\.(ts|js)$/;
const OG = /\.og\.(tsx|jsx)$/;
const skip = (e: string) => e.startsWith("_") || e.endsWith(".d.ts") || /\.(test|spec)\./.test(e) || OG.test(e);
const isGroup = (s: string) => /^\([^.)][^)]*\)$/.test(s);
const special = (name: string, e: string) => new RegExp(`^_${name}\\.(tsx|jsx)$`).test(e);

export function toSegments(parts: string[]): Segment[] {
  return parts
    .filter((s) => !isGroup(s))
    .map((s): Segment => {
      let m = s.match(/^\[\[\.\.\.(\w+)\]\]$/);
      if (m) return { kind: "optional", name: m[1] };
      m = s.match(/^\[\.\.\.(\w+)\]$/);
      if (m) return { kind: "rest", name: m[1] };
      m = s.match(/^\[(\w+)\]$/);
      if (m) return { kind: "param", name: m[1] };
      return { kind: "static", value: s };
    });
}

export const patternOf = (segments: Segment[]) =>
  "/" +
  segments
    .map((s) => (s.kind === "static" ? s.value : s.kind === "param" ? `[${s.name}]` : s.kind === "rest" ? `[...${s.name}]` : `[[...${s.name}]]`))
    .join("/");

function relSegments(base: string, file: string, ext: RegExp): string[] {
  const rel = relative(base, file).split(sep);
  rel[rel.length - 1] = rel[rel.length - 1].replace(ext, "");
  if (rel[rel.length - 1] === "index") rel.pop();
  return rel;
}

/** Most specific first: static segments beat params, params beat catch-alls, catch-alls beat
 *  optional catch-alls, longer beats shorter. Two files answering the same URLs are an error. */
export function sortRoutes<R extends { segments: Segment[]; file: string }>(routes: R[]): R[] {
  const r = { static: "0", param: "1", rest: "2", optional: "3" } as const;
  const rank = (x: R) => x.segments.map((s) => r[s.kind]).join("") + "4";
  routes.sort((a, b) => rank(a).localeCompare(rank(b)) || b.segments.length - a.segments.length);
  const seen = new Map<string, string>();
  for (const x of routes) {
    const key = x.segments.map((s) => (s.kind === "static" ? s.value : s.kind === "param" ? ":" : s.kind === "rest" ? "*" : "**")).join("/");
    if (seen.has(key)) throw new Error(`Two routes match the same URLs: ${seen.get(key)} and ${x.file}`);
    seen.set(key, x.file);
  }
  return routes;
}

/** "(..)(..)photo" -> { up: 2, name: "photo" }, "(...)x" -> { up: Infinity }, "(.)x" -> { up: 0 } */
function interceptOf(dir: string): { up: number; name: string } | null {
  const m = dir.match(/^((?:\(\.\.\))+|\(\.\)|\(\.\.\.\))(.+)$/);
  if (!m) return null;
  const up = m[1] === "(.)" ? 0 : m[1] === "(...)" ? Infinity : m[1].length / 4;
  return { up, name: m[2] };
}

export function scanRoutes(routesDir: string): RouteTable {
  const routes: Route[] = [];
  const slots: Slot[] = [];
  const intercepts: Route[] = [];
  let notFound: string | undefined;

  interface Ctx {
    /** URL parts (folder names, groups included) of this folder. */
    url: string[];
    layouts: string[];
    error?: string;
    loading?: string;
    slot?: Slot;
    /** Inside an intercepting folder: where navigation must start. */
    scope?: Segment[];
  }

  const walk = (dir: string, c: Ctx) => {
    const entries = readdirSync(dir).sort();
    const layout = entries.find((e) => special("layout", e));
    const layouts = layout ? [...c.layouts, join(dir, layout)] : c.layouts;
    const err = entries.find((e) => special("error", e));
    const load = entries.find((e) => special("loading", e));
    const here: Ctx = { ...c, layouts, error: err ? join(dir, err) : c.error, loading: load ? join(dir, load) : c.loading };
    const files = new Set(entries);

    for (const e of entries) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) {
        if (e.startsWith("_")) continue;
        if (e.startsWith("@")) {
          if (!layout) throw new Error(`${relative(routesDir, full)}: a slot needs a _layout.tsx in the same folder to receive it`);
          if (c.slot) throw new Error(`${relative(routesDir, full)}: slots can't be nested inside slots`);
          const slot: Slot = { name: e.slice(1), layout: join(dir, layout), routes: [], intercepts: [] };
          const def = readdirSync(full).find((f) => /^default\.(tsx|jsx)$/.test(f));
          if (def) slot.default = join(full, def);
          slots.push(slot);
          // Slot content isn't wrapped in the layout that receives it; it starts fresh.
          walk(full, { url: here.url, layouts: [], slot });
          continue;
        }
        const ic = interceptOf(e);
        if (ic) {
          const base = here.url.filter((p) => !isGroup(p));
          const kept = ic.up === Infinity ? [] : base.slice(0, Math.max(0, base.length - ic.up));
          walk(full, { ...here, url: [...kept, ic.name], scope: toSegments(here.url) });
          continue;
        }
        walk(full, { ...here, url: [...here.url, e] });
        continue;
      }
      if (special("404", e) && dir === routesDir && !c.slot) notFound = full;
      if (c.slot && dir.endsWith(`@${c.slot.name}`) && /^default\.(tsx|jsx)$/.test(e)) continue;
      if (skip(e) || !PAGE.test(e)) continue;
      const name = e.replace(PAGE, "");
      const segments = toSegments(name === "index" ? here.url : [...here.url, name]);
      const ogFile = [`${name}.og.tsx`, `${name}.og.jsx`].find((f) => files.has(f));
      const route: Route = {
        pattern: patternOf(segments),
        segments,
        file: full,
        kind: "page",
        layouts: here.layouts,
        error: here.error,
        loading: here.loading,
        og: ogFile ? join(dir, ogFile) : undefined,
        scope: here.scope,
      };
      if (c.slot) (here.scope ? c.slot.intercepts : c.slot.routes).push(route);
      else (here.scope ? intercepts : routes).push(route);
    }
  };
  walk(routesDir, { url: [], layouts: [] });
  sortRoutes(routes);
  sortRoutes(intercepts);
  for (const s of slots) {
    sortRoutes(s.routes);
    sortRoutes(s.intercepts);
  }
  const rootLayout = readdirSync(routesDir).find((e) => special("layout", e));
  return { routes, notFound, rootLayouts: rootLayout ? [join(routesDir, rootLayout)] : [], slots, intercepts };
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

/** MCP modules: every .ts/.js/.tsx file under app/mcp (folders starting with "_" are helpers). */
export function scanMcp(root: string): string[] {
  const dir = join(root, "app/mcp");
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const full = join(d, e);
      if (statSync(full).isDirectory()) {
        if (!e.startsWith("_")) walk(full);
        continue;
      }
      if (e.startsWith("_") || e.endsWith(".d.ts") || /\.(test|spec)\./.test(e) || !/\.(ts|tsx|js|jsx)$/.test(e)) continue;
      out.push(relative(root, full).split(sep).join("/"));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}
