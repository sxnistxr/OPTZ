// Route matching shared by the server and the browser runtime (no Node imports).
import type { Params } from "./types";

export type Segment =
  | { kind: "static"; value: string }
  | { kind: "param"; name: string }
  /** [...name]: one or more segments */
  | { kind: "rest"; name: string }
  /** [[...name]]: zero or more segments (last only) */
  | { kind: "optional"; name: string };

/** decodeURIComponent that answers null for malformed input ("%", "%zz") instead of throwing. */
export function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/** Matches a pathname against segments. Returns params or null (also for malformed escapes). */
export function matchSegments(segments: Segment[], pathname: string): Params | null {
  const parts = pathname.split("/").filter(Boolean);
  const params: Params = {};
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.kind === "rest" || s.kind === "optional") {
      if (i >= parts.length) return s.kind === "optional" ? params : null;
      const decoded = parts.slice(i).map(safeDecode);
      if (decoded.includes(null)) return null;
      params[s.name] = decoded.join("/");
      return params;
    }
    const p = parts[i];
    if (p === undefined) return null;
    if (s.kind === "static") {
      if (p !== s.value) return null;
    } else {
      const v = safeDecode(p);
      if (v === null) return null;
      params[s.name] = v;
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
  const out = segments.flatMap((s) => {
    if (s.kind === "static") return [s.value];
    const v = params[s.name];
    if (s.kind === "optional" && !v) return [];
    if (v === undefined) throw new Error(`missing param "${s.name}"`);
    return [s.kind === "param" ? encodeURIComponent(v) : v.split("/").map(encodeURIComponent).join("/")];
  });
  return "/" + out.join("/");
}

/** "/" -> "/_optz/data/index.json", "/blog/x" -> "/_optz/data/blog/x.json" */
export const dataPath = (pathname: string) => `/_optz/data${pathname === "/" ? "/index" : pathname.replace(/\/$/, "")}.json`;

/** Does `pathname` start inside `scope` (a folder's URL)? Params match anything. */
export function inScope(scope: Segment[], pathname: string): boolean {
  const parts = pathname.split("/").filter(Boolean);
  for (let i = 0; i < scope.length; i++) {
    const s = scope[i];
    if (s.kind === "rest") return parts.length > i;
    if (s.kind === "optional") return true;
    if (parts[i] === undefined) return false;
    if (s.kind === "static" && safeDecode(parts[i]) !== s.value) return false;
  }
  return true;
}
