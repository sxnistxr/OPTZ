/** Shared deterministic curves keep the no-JS fallback and WebGL scene aligned. */
export function trailPoint(t: number, lane: number, mode: "flow" | "speed", seed = 0) {
  const spread = lane - .5;
  const x = -60 + t * 1120;
  if (mode === "speed") {
    const envelope = Math.pow(Math.max(0, 1 - t), .8);
    const y = 205 - 100 * Math.sin(t * Math.PI * 1.35 - .3)
      + spread * 260 * envelope
      + Math.sin(t * 13 + lane * 5) * 45 * envelope;
    return { x, y };
  }
  const y = 205 + Math.sin(t * Math.PI * 4.3 + seed) * (58 + 38 * Math.cos(lane * 5))
    + Math.sin(t * 12 + lane * 5 + seed) * 40 + spread * 110;
  return { x, y };
}
