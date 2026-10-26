// Route matching shared by the server and the browser runtime (no Node imports).
import type { Params } from "./types";

export type Segment = { kind: "static"; value: string } | { kind: "param"; name: string } | { kind: "rest"; name: string };

/** Matches a pathname against segments. Returns params or null. */
export function matchSegments(segments: Segment[], pathname: string): Params | null {
  const parts = pathname.split("/").filter(Boolean);
  const params: Params = {};
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.kind === "rest") {
      if (i >= parts.length) return null;
      params[s.name] = parts.slice(i).map(decodeURIComponent).join("/");
      return params;
    }
    const p = parts[i];
    if (p === undefined) return null;
    if (s.kind === "static") {
      if (p !== s.value) return null;
    } else {
      params[s.name] = decodeURIComponent(p);
    }
  }
  return parts.length === segments.length ? params : null;
}

export function matchRoute<R extends { segments: Segment[] }>(routes: R[], pathname: string): { route: R; params: Params } | null {
  for (const route of routes) {
    const params = matchSegments(route.segments, pathname);
    if (params) return { route, params };
  }
  return null;
}

/** Fills a pattern with params: "/blog/[slug]" + {slug:"x"} -> "/blog/x". */
export function fillPattern(segments: Segment[], params: Params): string {
  const out = segments.map((s) => {
    if (s.kind === "static") return s.value;
    const v = params[s.name];
    if (v === undefined) throw new Error(`missing param "${s.name}"`);
    return s.kind === "rest" ? v.split("/").map(encodeURIComponent).join("/") : encodeURIComponent(v);
  });
  return "/" + out.join("/");
}

/** "/" -> "/_optz/data/index.json", "/blog/x" -> "/_optz/data/blog/x.json" */
export const dataPath = (pathname: string) => `/_optz/data${pathname === "/" ? "/index" : pathname.replace(/\/$/, "")}.json`;
