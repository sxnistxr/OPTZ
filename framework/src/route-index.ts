// A server-side index over an immutable manifest. Preserve original route precedence exactly.
import { matchSegments, type Segment } from "./match";
import type { Params } from "./types";

export function createRouteMatcher<R extends { segments: Segment[] }>(routes: readonly R[]) {
  type Candidate = { route: R; order: number };
  const exact = new Map<string, Candidate>();
  const prefixes = new Map<string, Candidate[]>();
  const generic: Candidate[] = [];
  routes.forEach((route, order) => {
    const candidate = { route, order };
    if (route.segments.every(s => s.kind === "static" && s.value && !s.value.includes("/"))) {
      const key = route.segments.map(s => (s as Extract<Segment, { kind: "static" }>).value).join("/");
      if (!exact.has(key)) exact.set(key, candidate);
    } else {
      const first = route.segments[0];
      if (first?.kind !== "static") generic.push(candidate);
      else {
        let bucket = prefixes.get(first.value);
        if (!bucket) prefixes.set(first.value, bucket = []);
        bucket.push(candidate);
      }
    }
  });
  return (pathname: string): { route: R; params: Params } | null => {
    const parts = pathname.split("/").filter(Boolean);
    const hit = exact.get(parts.join("/"));
    const bucket = prefixes.get(parts[0]) ?? [];
    // Merge only the relevant dynamic routes in manifest order; skip unrelated static routes.
    let a = 0, b = 0;
    while (a < bucket.length || b < generic.length) {
      const candidate = b >= generic.length || (a < bucket.length && bucket[a].order < generic[b].order) ? bucket[a++] : generic[b++];
      if (hit && candidate.order > hit.order) break;
      const params = matchSegments(candidate.route.segments, pathname);
      if (params) return { route: candidate.route, params };
    }
    return hit ? { route: hit.route, params: {} } : null;
  };
}
