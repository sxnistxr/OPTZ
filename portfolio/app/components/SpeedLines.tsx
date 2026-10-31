import { markCells, cellPoints, hash } from "$lib/speed-geometry";

/**
 * The speed scene as static SVG: tailed streaks, and optionally the landed mark. Ships no JavaScript.
 * `converge` gathers the streaks toward the right, where a closing call to action sits.
 */
export function SpeedLines({ mark = false, converge = false, streaks = 70, className }: { mark?: boolean; converge?: boolean; streaks?: number; className?: string }) {
  // Islands hydrate as their own roots, so a useId would differ; the props make the id unique on a page.
  const tail = `streak-tail-${mark ? "m" : ""}${converge ? "c" : ""}${streaks}`;
  return <svg className={className} viewBox="-100 -40 200 80" preserveAspectRatio="xMidYMid slice" fill={`url(#${tail})`} aria-hidden="true">
    <defs><linearGradient id={tail}><stop offset="0" stopColor="currentColor" stopOpacity="0" /><stop offset="1" stopColor="currentColor" /></linearGradient></defs>
    {Array.from({ length: streaks }, (_, i) => {
      const near = Math.pow(hash(i * 3 + 1), 1.6), lead = hash(i * 13 + 5) > .88;
      const along = hash(i * 5 + 3), x = converge ? -70 + along * 140 : -100 + along * 200;
      // Converging streaks narrow toward the right end, like lanes merging into one.
      const y = (hash(i * 3 + 2) - .5) * 70 * (converge ? 1 - along * .75 : 1);
      const w = (6 + near * 18) * (lead ? 1.6 : 1), h = (.5 + near * .9) * (lead ? 1.3 : 1);
      return <polygon key={i} opacity={((.18 + near * .5) * (lead ? 1.4 : 1)).toFixed(2)} points={cellPoints({ x, y, w, h, s: 1.1 })} />;
    })}
    {mark && <g fill="currentColor" transform="scale(.6)">{markCells().map((c, i) => <polygon key={i} points={cellPoints(c)} />)}</g>}
  </svg>;
}
