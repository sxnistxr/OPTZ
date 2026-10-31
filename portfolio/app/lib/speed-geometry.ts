/** The OPTZ mark as small slanted cells, plus deterministic streaks: shared by the WebGL scene and its static SVG. */
export type Cell = { x: number; y: number; w: number; h: number; s: number };

// The mark's four strokes in its 72×44 viewBox: top y, bottom y, top-left x, bottom-left x, width.
const STROKES = [[3, 13, 30, 19, 35], [17, 27, 19, 8, 31], [31, 40, 10, 0, 24], [17, 40, 54, 28, 15]];

/** Cells centred on the mark, y up; `s` is the lean (x shift per unit of height), the same as the logo's. */
export function markCells(cw = 3.2, ch = 2.6): Cell[] {
  const cells: Cell[] = [];
  for (const [y0, y1, xt, xb, w] of STROKES) {
    const rows = Math.max(1, Math.round((y1 - y0) / ch)), rh = (y1 - y0) / rows;
    const cols = Math.max(1, Math.round(w / cw)), cwid = w / cols, s = (xt - xb) / (y1 - y0);
    for (let r = 0; r < rows; r++) {
      const yc = y0 + (r + .5) * rh, left = xt + (xb - xt) * (yc - y0) / (y1 - y0);
      for (let c = 0; c < cols; c++) cells.push({ x: left + (c + .5) * cwid - 36, y: 22 - yc, w: cwid * .8, h: rh * .72, s });
    }
  }
  return cells;
}

export const hash = (n: number) => { const v = Math.sin(n * 12.9898 + 4.1414) * 43758.5453; return v - Math.floor(v); };

/** A leaning parallelogram as SVG points (y down) around a y-up centre. */
export function cellPoints({ x, y, w, h, s }: Cell) {
  const f = (n: number) => Math.round(n * 100) / 100;
  const top = -(y + h / 2), bottom = -(y - h / 2), dx = s * h / 2;
  return `${f(x + dx - w / 2)},${f(top)} ${f(x + dx + w / 2)},${f(top)} ${f(x - dx + w / 2)},${f(bottom)} ${f(x - dx - w / 2)},${f(bottom)}`;
}
