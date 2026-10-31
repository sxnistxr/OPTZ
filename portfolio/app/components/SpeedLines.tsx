import { markCells, cellPoints, hash } from "$lib/speed-geometry";

/** The speed scene as static SVG: streaks, and optionally the assembled mark. Ships no JavaScript. */
export function SpeedLines({ mark = false, streaks = 70, className }: { mark?: boolean; streaks?: number; className?: string }) {
  return <svg className={className} viewBox="-100 -40 200 80" preserveAspectRatio="xMidYMid slice" fill="currentColor" aria-hidden="true">
    {Array.from({ length: streaks }, (_, i) => {
      const near = hash(i * 3 + 1), w = 3 + near * 9, h = .6 + near * 1;
      return <polygon key={i} opacity={(.1 + near * .4).toFixed(2)} points={cellPoints({ x: -100 + hash(i * 5 + 3) * 200, y: (hash(i * 3 + 2) - .5) * 78, w, h, s: 1.1 })} />;
    })}
    {mark && <g transform="scale(.6)">{markCells().map((c, i) => <polygon key={i} points={cellPoints(c)} />)}</g>}
  </svg>;
}
