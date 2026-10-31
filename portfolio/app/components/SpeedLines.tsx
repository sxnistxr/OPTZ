import { markLines, cellPoints, hash } from "$lib/speed-geometry";

/**
 * The speed scene as static SVG: thin trails that fade toward their tails, and optionally the mark drawn
 * in light lines. Ships no JavaScript. `converge` gathers the trails toward the right, where a closing
 * call to action sits.
 */
export function SpeedLines({ mark = false, converge = false, streaks = 70, className }: { mark?: boolean; converge?: boolean; streaks?: number; className?: string }) {
  // Islands hydrate as their own roots, so a useId would differ; the props make the id unique on a page.
  const tail = `streak-tail-${mark ? "m" : ""}${converge ? "c" : ""}${streaks}`;
  return <svg className={className} viewBox="-100 -40 200 80" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id={tail}><stop offset="0" stopColor="currentColor" stopOpacity="0" /><stop offset="1" stopColor="currentColor" /></linearGradient></defs>
    <g fill={`url(#${tail})`}>
      {Array.from({ length: streaks }, (_, i) => {
        const near = Math.pow(hash(i * 3 + 1), 1.5), lead = hash(i * 13 + 5) > .9;
        const along = hash(i * 5 + 3), x = converge ? -70 + along * 140 : -100 + along * 200;
        // Converging trails narrow toward the right end, like lanes merging into one.
        const y = (hash(i * 3 + 2) - .5) * 70 * (converge ? 1 - along * .75 : 1);
        const w = (8 + near * 30) * (lead ? 1.7 : 1), h = (.18 + near * .3) * (lead ? 1.3 : 1);
        return <rect key={i} x={(x - w / 2).toFixed(2)} y={(y - h / 2).toFixed(2)} width={w.toFixed(2)} height={h.toFixed(2)} rx={(h / 2).toFixed(2)} opacity={((.2 + near * .55) * (lead ? 1.3 : 1)).toFixed(2)} />;
      })}
    </g>
    {mark && <g fill="currentColor" transform="scale(.6)">{markLines().map((line, i) => <polygon key={i} points={cellPoints(line)} />)}</g>}
  </svg>;
}
