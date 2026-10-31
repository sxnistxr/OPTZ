import {
  WebGLRenderer, Scene, PerspectiveCamera, InstancedBufferGeometry, InstancedBufferAttribute,
  Float32BufferAttribute, ShaderMaterial, Mesh, Color, Vector2, LinearSRGBColorSpace,
} from "three";
import { markCells, hash } from "./speed-geometry";
import type { TrailController } from "./trail-scene";

/**
 * "Served from memory": leaning bars stream past in depth; a request speeds them into streaks,
 * then they snap into the OPTZ mark, hold, and release back into the stream.
 */
export function createSpeed(host: HTMLElement, reduced: boolean,
  onRunning: (running: boolean) => void, onFailure: () => void): TrailController | null {
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ alpha: true, antialias: devicePixelRatio < 2, powerPreference: "low-power" }); }
  catch { return null; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  const scene = new Scene();
  const camZ = 120, fov = 30;
  const camera = new PerspectiveCamera(fov, 1, 1, 500);
  camera.position.z = camZ;

  // Every bar is one instance of a unit quad; position, size and lean all happen in the vertex shader.
  const cells = markCells();
  const mobile = host.clientWidth < 600;
  const count = cells.length + (mobile ? 90 : 240);
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = count;
  const stream = new Float32Array(count * 4), target = new Float32Array(count * 4), meta = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const depth = hash(i * 3 + 1), cell = cells[i];
    // Stream: normalised y, depth z (nearer is faster and longer), speed, phase along the span.
    stream.set([hash(i * 3 + 2) - .5, -80 + depth * 95, 10 + depth * 30 + hash(i * 7) * 8, hash(i * 5 + 3)], i * 4);
    if (cell) target.set([cell.x, cell.y, cell.w, cell.h], i * 4);
    meta.set([cell ? 1 : 0, cell ? (cell.x + 36) / 72 : 0, cell ? cell.s : 1.1], i * 3);
  }
  geometry.setAttribute("aStream", new InstancedBufferAttribute(stream, 4));
  geometry.setAttribute("aTarget", new InstancedBufferAttribute(target, 4));
  geometry.setAttribute("aMeta", new InstancedBufferAttribute(meta, 3));
  const ink = new Color();
  const uniforms = {
    uTravel: { value: 0 }, uBoost: { value: .6 }, uForm: { value: 0 }, uScale: { value: .72 },
    uAspect: { value: 1 }, uTanHalf: { value: Math.tan(fov * Math.PI / 360) }, uCamZ: { value: camZ },
    uInk: { value: ink }, uGain: { value: 1 }, uLift: { value: .15 }, uTilt: { value: new Vector2() },
  };
  const material = new ShaderMaterial({ transparent: true, depthWrite: false, uniforms,
    vertexShader: `attribute vec4 aStream; attribute vec4 aTarget; attribute vec3 aMeta;
      uniform float uTravel; uniform float uBoost; uniform float uForm; uniform float uScale;
      uniform float uAspect; uniform float uTanHalf; uniform float uCamZ;
      varying float vAlpha; varying float vU; varying float vForm;
      void main(){
        float z=aStream.y, height=2.*(uCamZ-z)*uTanHalf, span=height*uAspect+40.;
        float x=mod(aStream.w*span+uTravel*aStream.z,span)-span*.5;
        float near=smoothstep(-80.,15.,z);
        vec2 streak=vec2((1.5+near*4.)*(.5+uBoost*1.6),.35+near*.6);
        float f=clamp(uForm*1.6-aMeta.y*.6,0.,1.); f=(1.-pow(1.-f,4.))*aMeta.x;
        vec3 centre=mix(vec3(x,aStream.x*height,z),vec3(aTarget.xy*uScale,0.),f);
        vec2 size=mix(streak,aTarget.zw*uScale,f);
        vec2 local=position.xy*size; local.x+=aMeta.z*local.y;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(centre+vec3(local,0.),1.);
        float edge=1.-smoothstep(.36,.5,abs(x/span));
        vAlpha=mix((.07+.43*near)*edge*(1.-uForm*.55),1.,f);
        vAlpha*=mix(1.-smoothstep(.62,.98,abs(gl_Position.y/gl_Position.w)),1.,f);
        vU=position.x+.5; vForm=f;
      }`,
    fragmentShader: `uniform vec3 uInk; uniform float uGain; uniform float uLift;
      varying float vAlpha; varying float vU; varying float vForm;
      void main(){
        float tail=mix(smoothstep(0.,1.,vU),1.,vForm);
        vec3 c=mix(uInk,vec3(1.),uLift*vForm);
        gl_FragColor=vec4(c,min(1.,vAlpha*tail*uGain));
      }` });
  const bars = new Mesh(geometry, material);
  bars.frustumCulled = false;
  scene.add(bars);

  const theme = () => {
    // Raw shader output is written as-is, so keep the CSS color's sRGB numbers instead of converting to linear.
    ink.setStyle(getComputedStyle(host).color, LinearSRGBColorSpace);
    const light = document.documentElement.dataset.theme === "light";
    uniforms.uGain.value = light ? 1.3 : 1; uniforms.uLift.value = light ? 0 : .15;
    render();
  };
  const fine = matchMedia("(pointer: fine)").matches;
  const tilt = { x: 0, y: 0 }, aim = { x: 0, y: 0 };
  const zone = host.closest("section") ?? host;
  const move = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    aim.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    aim.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
  };
  const leave = () => { aim.x = aim.y = 0; };
  if (fine) { zone.addEventListener("pointermove", move as EventListener); zone.addEventListener("pointerleave", leave); }

  let frame = 0, active = false, paused = false, visible = true, disposed = false, lost = false, elapsed = 0, last = 0;
  const duration = 3200;
  const smooth = (a: number, b: number, t: number) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
  // Speed up (0–350 ms), assemble (250–950), hold, release (2300–3200).
  const timeline = (t: number) => {
    uniforms.uBoost.value = .6 + 5.4 * smooth(0, 350, t) * (1 - smooth(350, 900, t)) + 1.2 * smooth(2300, 2700, t) * (1 - smooth(2700, 3200, t));
    uniforms.uForm.value = smooth(250, 950, t) * (1 - smooth(2300, 3200, t));
  };
  const render = () => {
    if (disposed || lost) return;
    camera.position.set(tilt.x * 7, -tilt.y * 4, camZ); camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  };
  function tick(now: number) {
    frame = 0;
    if (disposed || lost || !visible || document.hidden || reduced || paused) return;
    const delta = Math.min(now - last, 50) / 1000; last = now;
    if (active) { elapsed += delta * 1000; timeline(elapsed); if (elapsed >= duration) { active = false; timeline(duration); onRunning(false); } }
    uniforms.uTravel.value += delta * uniforms.uBoost.value;
    const k = 1 - Math.exp(-delta * 4);
    tilt.x += (aim.x - tilt.x) * k; tilt.y += (aim.y - tilt.y) * k;
    render();
    frame = requestAnimationFrame(tick);
  }
  function resume() {
    if (!disposed && !reduced && !paused && visible && !document.hidden && !lost && !frame) {
      last = performance.now(); frame = requestAnimationFrame(tick);
    }
  }
  function stop() { cancelAnimationFrame(frame); frame = 0; }
  // Reduced motion: a still frame of the assembled mark in its stream.
  function still() { uniforms.uTravel.value = 3; uniforms.uBoost.value = .6; uniforms.uForm.value = 1; render(); }
  function replay() {
    if (disposed || lost || paused) return;
    if (reduced) { still(); onRunning(false); return; }
    elapsed = 0; active = true; onRunning(true); resume();
  }
  function fit() {
    if (disposed || lost) return;
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight), aspect = width / height;
    camera.aspect = aspect; camera.updateProjectionMatrix();
    uniforms.uAspect.value = aspect;
    // Fit the mark: at most 55% of the visible height and 70% of the width at z = 0.
    const visibleHeight = 2 * camZ * uniforms.uTanHalf.value;
    uniforms.uScale.value = Math.min(visibleHeight * .55 / 44, visibleHeight * aspect * .7 / 72);
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
  theme(); fit(); host.classList.add("webgl-ready");
  if (reduced) { still(); onRunning(false); } else replay();
  return {
    replay,
    setReduced(value) {
      reduced = value;
      if (value) { stop(); active = false; still(); onRunning(false); } else resume();
    },
    setPaused(value) { paused = value; if (value) stop(); else resume(); },
    dispose() {
      disposed = true; stop(); resize.disconnect(); observer.disconnect(); themeWatch.disconnect();
      zone.removeEventListener("pointermove", move as EventListener); zone.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", contextRestored);
      geometry.dispose(); material.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); host.classList.remove("webgl-ready");
    },
  };
}
