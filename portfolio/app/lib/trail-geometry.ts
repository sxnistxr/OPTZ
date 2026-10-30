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
}`;
