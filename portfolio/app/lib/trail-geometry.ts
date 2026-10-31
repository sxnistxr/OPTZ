/** Shared deterministic curves keep the no-JS fallback and WebGL scene aligned. */
export function trailPoint(t: number, lane: number, mode: "flow" | "speed", seed = 0, time = 0, out = { x: 0, y: 0 }) {
  const spread = lane - .5;
  out.x = -60 + t * 1120;
  if (mode === "speed") {
    const envelope = Math.pow(Math.max(0, 1 - t), .8);
    out.y = 205 - 95 * Math.sin(t * Math.PI * 1.35 - .3)
      + spread * 210 * envelope
      + Math.sin(t * 9 + lane * 2.2) * 28 * envelope
      + Math.sin(t * 7 - time * .55) * 5 * Math.sin(t * Math.PI) * envelope;
  } else {
    out.y = 205 + Math.sin(t * Math.PI * 2.7 + seed) * (50 + 22 * Math.cos(lane * 4.4))
      + Math.sin(t * Math.PI * 1.4 + lane * 2.4 + seed * .55) * 24
      + spread * (84 + 34 * Math.sin(t * Math.PI * 2.2 + seed * .6))
      + Math.sin(t * 6 - time * .35 + seed) * Math.sin(t * Math.PI) * 12;
  }
  return out;
}

/** One lane as a smooth SVG path: Catmull-Rom through a few samples, so static trails stay small. */
export function trailPath(mode: "flow" | "speed", lane: number, segments = 28, seed = 0) {
  const pts = Array.from({ length: segments + 1 }, (_, i) => {
    const p = trailPoint(i / segments, lane, mode, seed);
    return [p.x, 400 - p.y];
  });
  const f = (n: number) => Math.round(n * 10) / 10;
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < segments; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(segments, i + 2)];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} ${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  return d;
}

export const trailCurveGLSL = `
vec2 trailPosition(float t, float lane, float mode, float seed, float time) {
  float spread=lane-.5;
  float y;
  if(mode>.5) {
    float envelope=pow(max(0.,1.-t),.8);
    y=205.-95.*sin(t*3.14159265*1.35-.3)+spread*210.*envelope
      +sin(t*9.+lane*2.2)*28.*envelope
      +sin(t*7.-time*.55)*5.*sin(t*3.14159265)*envelope;
  } else {
    y=205.+sin(t*3.14159265*2.7+seed)*(50.+22.*cos(lane*4.4))
      +sin(t*3.14159265*1.4+lane*2.4+seed*.55)*24.
      +spread*(84.+34.*sin(t*3.14159265*2.2+seed*.6))
      +sin(t*6.-time*.35+seed)*sin(t*3.14159265)*12.;
  }
  return vec2(-60.+t*1120.,y);
}
// Depth and pointer: lanes sit on layers that shift with uTilt, and part around uPointer (xy, z = strength).
uniform vec2 uTilt; uniform vec3 uPointer;
vec2 trailField(vec2 p, float lane) {
  float depth=lane-.5;
  p+=vec2(uTilt.x*46.,uTilt.y*-18.)*depth;
  vec2 d=p-uPointer.xy;
  float falloff=exp(-d.x*d.x/16200.)*exp(-d.y*d.y/22000.);
  p.y+=d.y/(abs(d.y)+14.)*falloff*30.*uPointer.z;
  return p;
}`;
