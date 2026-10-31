import {
  WebGLRenderer, Scene, OrthographicCamera, BufferGeometry, Float32BufferAttribute,
  ShaderMaterial, LineSegments, Points, Color, Vector2, Vector3, LinearSRGBColorSpace,
} from "three";
import { trailCurveGLSL } from "./trail-geometry";

export interface TrailController {
  replay(): void;
  setReduced(value: boolean): void;
  setPaused(value: boolean): void;
  dispose(): void;
}

export function createTrail(host: HTMLElement, reduced: boolean,
  onRunning: (running: boolean) => void, onFailure: () => void): TrailController | null {
  let renderer: WebGLRenderer;
  // Hairlines on a dense screen are already smooth; skip the multisample cost there.
  try { renderer = new WebGLRenderer({ alpha: true, antialias: devicePixelRatio < 2, powerPreference: "low-power" }); }
  catch { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0x080808, 0);
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  const scene = new Scene();
  const camera = new OrthographicCamera(0, 1000, 400, 0, .1, 1000);
  camera.position.z = 500;
  const resources: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(v: T): T => { resources.push(v); return v; };
  const mobile = host.clientWidth < 600;
  const count = mobile ? 64 : 112;
  const steps = 180;
  // The shader computes every curve, so a vertex only carries (progress, lane); shared vertices are indexed.
  const geometry = keep(new BufferGeometry());
  const vertices = new Float32Array(count * (steps + 1) * 3), index: number[] = [];
  for (let lane = 0; lane < count; lane++) {
    const base = lane * (steps + 1);
    for (let j = 0; j <= steps; j++) {
      vertices[(base + j) * 3] = j / steps; vertices[(base + j) * 3 + 1] = lane / (count - 1);
      if (j < steps) index.push(base + j, base + j + 1);
    }
  }
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(index);
  const ink = new Color(), spark = new Color();
  const uniforms = {
    uTime: { value: 0 }, uPhase: { value: 0 },
    uSeed: { value: 0 }, uHeightScale: { value: 1 },
    uTilt: { value: new Vector2() }, uPointer: { value: new Vector3(500, 200, 0) },
    uInk: { value: ink }, uSpark: { value: spark }, uGain: { value: 1 },
  };
  const lines = keep(new ShaderMaterial({ transparent: true, depthWrite: false, uniforms,
    vertexShader: `uniform float uTime; uniform float uSeed; uniform float uHeightScale; 
      varying float vLane; varying float vProgress;
      ${trailCurveGLSL}
      void main(){vProgress=position.x;vLane=position.y;
        vec2 p=trailPosition(vProgress,vLane,uSeed,uTime);
        p.y=200.+(p.y-200.)*uHeightScale;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(trailField(p,vLane),-2.,1.);}`,
    fragmentShader: `uniform float uPhase; uniform vec3 uInk; uniform float uGain;
      varying float vLane; varying float vProgress;
      void main(){
        float pulse=pow(max(0.,cos((vProgress-uPhase)*12.56637+vLane*.5)),16.);
        float ink=.14+.28*pow(sin(vLane*93.)*.5+.5,5.);
        float edge=smoothstep(0.,.06,vProgress)*(1.-smoothstep(.94,1.,vProgress));
        float lane=.45+.55*sin(vLane*3.14159);
        gl_FragColor=vec4(uInk,min(1.,(ink+pulse*.28)*edge*lane*uGain));}` }));
  const ribbons = new LineSegments(geometry, lines);
  ribbons.frustumCulled = false;
  scene.add(ribbons);
  const particles = keep(new BufferGeometry());
  const positions: number[] = [], seeds: number[] = [];
  const particleCount = mobile ? 72 : 144;
  for (let i = 0; i < particleCount; i++) {
    positions.push(0, 0, 0);
    seeds.push(((i * 73) % 149) / 149, ((i * 41) % 151) / 151);
  }
  particles.setAttribute("position", new Float32BufferAttribute(positions, 3));
  particles.setAttribute("aSeed", new Float32BufferAttribute(seeds, 2));
  const sparks = keep(new ShaderMaterial({ transparent: true, depthWrite: false,
    uniforms: { ...uniforms, uRatio: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute vec2 aSeed; uniform float uTime; uniform float uPhase;
      uniform float uSeed; uniform float uHeightScale; uniform float uRatio;
      varying float vAlpha;
      ${trailCurveGLSL}
      void main(){float t=fract(aSeed.x+uPhase);float lane=aSeed.y;
        vec2 p=trailPosition(t,lane,uSeed,uTime);p.y=200.+(p.y-200.)*uHeightScale;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(trailField(p,lane),2.,1.);
        gl_PointSize=(1.5+pow(lane,5.)*2.)*uRatio;
        vAlpha=(.15+lane*.45)*smoothstep(0.,.08,t)*(1.-smoothstep(.9,1.,t));}`,
    fragmentShader: `uniform vec3 uSpark; uniform float uGain; varying float vAlpha;void main(){
      float alpha=1.-smoothstep(.12,.5,length(gl_PointCoord-vec2(.5)));
      gl_FragColor=vec4(uSpark,min(1.,vAlpha*alpha*uGain));}` }));
  const points = new Points(particles, sparks);
  points.frustumCulled = false;
  scene.add(points);

  // Ink follows the theme through the viewport's CSS color: no filter on the canvas, which would cost a composite.
  const theme = () => {
    // Raw shader output is written as-is, so keep the CSS color's sRGB numbers instead of converting to linear.
    ink.setStyle(getComputedStyle(host).color, LinearSRGBColorSpace);
    const light = document.documentElement.dataset.theme === "light";
    spark.copy(ink).offsetHSL(0, 0, light ? -.04 : .06);
    uniforms.uGain.value = light ? 1.6 : 1;
    render();
  };
  // Pointer: eased toward the target each frame, so the field settles instead of snapping.
  const fine = matchMedia("(pointer: fine)").matches;
  const tilt = { x: 0, y: 0 }, aim = { x: 0, y: 0, px: 500, py: 200, on: 0 };
  const zone = host.closest("section") ?? host;
  const move = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    aim.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    aim.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    aim.px = (e.clientX - r.left) / r.width * 1000;
    aim.py = 200 + (.5 - (e.clientY - r.top) / r.height) * 400 * uniforms.uHeightScale.value;
    aim.on = e.clientY >= r.top && e.clientY <= r.bottom ? 1 : 0;
  };
  const leave = () => { aim.x = aim.y = 0; aim.on = 0; };
  if (fine) { zone.addEventListener("pointermove", move as EventListener); zone.addEventListener("pointerleave", leave); }

  let frame = 0, active = false, paused = false, visible = true, disposed = false, lost = false;
  let elapsed = 0, clock = 0, particlePhase = 0, last = 0, seed = 0, seedFrom = 0, seedTo = 0;
  const duration = 1400;
  const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const render = () => {
    if (disposed || lost) return;
    const t = active ? Math.min(elapsed / duration, 1) : 1;
    uniforms.uSeed.value = seedFrom + (seedTo - seedFrom) * ease(t);
    uniforms.uTime.value = clock; uniforms.uPhase.value = particlePhase;
    renderer.render(scene, camera);
  };
  function tick(now: number) {
    frame = 0;
    if (disposed || lost || !visible || document.hidden || reduced || paused) return;
    const delta = Math.min(now - last, 50) / 1000; last = now;
    clock += delta;
    if (active) elapsed += delta * 1000;
    particlePhase = (particlePhase + delta * .045) % 1;
    if (active && elapsed >= duration) { active = false; onRunning(false); }
    const k = 1 - Math.exp(-delta * 4), pointer = uniforms.uPointer.value;
    tilt.x += (aim.x - tilt.x) * k; tilt.y += (aim.y - tilt.y) * k;
    uniforms.uTilt.value.set(tilt.x, tilt.y);
    pointer.x += (aim.px - pointer.x) * k * 1.6; pointer.y += (aim.py - pointer.y) * k * 1.6;
    pointer.z += (aim.on - pointer.z) * k;
    render();
    frame = requestAnimationFrame(tick);
  }
  function resume() {
    if (!disposed && !reduced && !paused && visible && !document.hidden && !lost && !frame) {
      last = performance.now(); frame = requestAnimationFrame(tick);
    }
  }
  function stop() { cancelAnimationFrame(frame); frame = 0; }
  function replay() {
    if (disposed || lost || paused) return;
    elapsed = 0;
    seedFrom = uniforms.uSeed.value; seedTo = ++seed * .7;
    active = !reduced; onRunning(active); render(); resume();
  }
  function fit() {
    if (disposed || lost) return;
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    const worldHeight = 1000 * height / width;
    camera.top = 200 + worldHeight / 2; camera.bottom = 200 - worldHeight / 2;
    camera.updateProjectionMatrix();
    uniforms.uHeightScale.value = worldHeight / 400;
    renderer.setSize(width, height, false); render();
  }
  const resize = new ResizeObserver(fit); resize.observe(host);
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) resume(); else stop(); }); observer.observe(host);
  const visibility = () => { if (document.hidden) stop(); else resume(); }; document.addEventListener("visibilitychange", visibility);
  const contextLost = (e: Event) => { e.preventDefault(); lost = true; stop(); host.classList.remove("webgl-ready"); onFailure(); };
  const contextRestored = () => { lost = false; onRunning(active); fit(); host.classList.add("webgl-ready"); resume(); };
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  renderer.domElement.addEventListener("webglcontextrestored", contextRestored);
  const themeWatch = new MutationObserver(theme); themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  theme(); fit(); host.classList.add("webgl-ready"); if (!reduced) replay(); else onRunning(false);
  return {
    replay,
    setReduced(value) {
      reduced = value;
      if (value) { stop(); active = false; onRunning(false); render(); } else resume();
    },
    setPaused(value) { paused = value; if (value) stop(); else resume(); },
    dispose() {
      disposed = true; stop(); resize.disconnect(); observer.disconnect(); themeWatch.disconnect();
      zone.removeEventListener("pointermove", move as EventListener); zone.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", contextRestored);
      resources.forEach(r => r.dispose()); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); host.classList.remove("webgl-ready");
    },
  };
}
