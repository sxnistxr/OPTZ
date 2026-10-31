import { trailPath } from "$lib/trail-geometry";

/** The trail as static SVG: the island's no-JS fallback, and quiet echoes elsewhere that ship no JavaScript. */
export function TrailLines({ mode, lanes = 40, segments = 28, seed = 0, className }: { mode: "flow" | "speed"; lanes?: number; segments?: number; seed?: number; className?: string }) {
  return <svg className={className} viewBox="0 0 1000 400" preserveAspectRatio="none" fill="none" aria-hidden="true">
    {Array.from({ length: lanes }, (_, i) => <path key={i} d={trailPath(mode, i / (lanes - 1), segments, seed)} stroke="currentColor" strokeOpacity={i % 4 === 0 ? .7 : .25} strokeWidth=".8" vectorEffect="non-scaling-stroke" />)}
  </svg>;
}
