import {
  WebGLRenderer, Scene, PerspectiveCamera, InstancedBufferGeometry, InstancedBufferAttribute,
  Float32BufferAttribute, ShaderMaterial, Mesh, Color, LinearSRGBColorSpace, AdditiveBlending, NormalBlending,
} from "three";
import { markCells, hash } from "./speed-geometry";
import type { TrailController } from "./trail-scene";

/**
 * "Served from memory": leaning streaks stream behind the hero. A request speeds them up, and the
 * mark's cells fly in from the left, line up with their rows, land, and are swept with light; then
 * they leave to the right. Everything moves left to right, the direction of the stream.
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
  const count = cells.length + (mobile ? 140 : 320);
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = count;
  const stream = new Float32Array(count * 4), target = new Float32Array(count * 4), meta = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    // Depth skews far, so most of the stream is fine dust and a few streaks pass close.
    const depth = Math.pow(hash(i * 3 + 1), 1.6), cell = cells[i];
    // Stream: normalised y, depth z (nearer is faster), speed, phase along the span.
    stream.set([hash(i * 3 + 2) - .5, -90 + depth * 105, 10 + depth * 34 + hash(i * 7) * 8, hash(i * 5 + 3)], i * 4);
    if (cell) target.set([cell.x, cell.y, cell.w, cell.h], i * 4);
    // Meta: in the mark, stagger (left to right), lean, look (the top 12% are bright leads).
    meta.set([cell ? 1 : 0, cell ? (cell.x + 36) / 72 * .8 + hash(i * 11) * .2 : 0, cell ? cell.s : 1.1, hash(i * 13 + 5)], i * 4);
  }
  geometry.setAttribute("aStream", new InstancedBufferAttribute(stream, 4));
  geometry.setAttribute("aTarget", new InstancedBufferAttribute(target, 4));
  geometry.setAttribute("aMeta", new InstancedBufferAttribute(meta, 4));
  const ink = new Color(), hot = new Color();
  const uniforms = {
    uTravel: { value: 0 }, uBoost: { value: .6 }, uForm: { value: 0 }, uRelease: { value: 0 }, uSweep: { value: -1 },
    uScale: { value: .72 }, uMarkY: { value: 0 }, uTextFrac: { value: 0 },
    uAspect: { value: 1 }, uTanHalf: { value: Math.tan(fov * Math.PI / 360) }, uCamZ: { value: camZ },
    uInk: { value: ink }, uHot: { value: hot }, uGain: { value: 1 }, uStreamGain: { value: 1 },
  };
  const material = new ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, uniforms,
    vertexShader: `attribute vec4 aStream; attribute vec4 aTarget; attribute vec4 aMeta;
      uniform float uTravel; uniform float uBoost; uniform float uForm; uniform float uRelease; uniform float uSweep;
      uniform float uScale; uniform float uMarkY; uniform float uTextFrac;
      uniform float uAspect; uniform float uTanHalf; uniform float uCamZ;
      varying vec2 vUv; varying float vAlpha; varying float vLand; varying float vHead; varying float vGlow;
      void main(){
        float z=aStream.y, height=2.*(uCamZ-z)*uTanHalf, span=height*uAspect+40.;
        float near=smoothstep(-90.,15.,z), lead=step(.88,aMeta.w), mark=aMeta.x;
        float x=mod(aStream.w*span+uTravel*aStream.z,span)-span*.5;
        vec3 from=vec3(x,aStream.x*height,z);
        // Mark cells are not part of the idle stream: they enter off the left edge and leave off the right.
        if(mark>.5) from.x=mix(-span*.5-6.-aMeta.w*30.,span*.5+6.+aMeta.w*30.,uRelease);
        float f=clamp(uForm*1.6-aMeta.y*.6,0.,1.)*mark;
        float ex=1.-pow(1.-f,4.), ey=1.-pow(1.-min(1.,f*1.8),3.), land=smoothstep(.8,1.,f);
        vec3 slot=vec3(aTarget.xy*uScale+vec2(0.,uMarkY),0.);
        vec3 centre=vec3(mix(from.x,slot.x,ex),mix(from.y,slot.y,ey),mix(from.z,0.,ey));
        // Streaks lengthen with speed; flying cells stay stretched until they land.
        vec2 streak=vec2((1.1+near*4.6)*(.45+uBoost*1.5)*(1.+lead*.9),(.26+near*.5)*(1.+lead*.3));
        streak.x*=1.+2.5*(1.-land)*step(.001,f);
        vec2 size=mix(streak,aTarget.zw*uScale,land);
        vec2 local=position.xy*size; local.x+=aMeta.z*local.y;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(centre+vec3(local,0.),1.);
        // Dim behind the copy, fade at the wrap edges and the bottom of the hero.
        float sy=.5-.5*gl_Position.y/gl_Position.w;
        float screen=(1.-smoothstep(.88,1.,sy))*mix(.14,1.,smoothstep(uTextFrac-.1,uTextFrac+.03,sy));
        float edge=1.-smoothstep(.34,.5,abs(x/span));
        float idle=(.05+.45*near)*(1.+lead*.8*screen)*edge*screen*(1.-uForm*.45);
        vAlpha=mix(idle*(1.-mark),1.,ey);
        vUv=position.xy+.5; vLand=land; vHead=(.3+.7*lead)*(.4+.6*near);
        vGlow=land*exp(-pow((aMeta.y-uSweep)*6.,2.));
      }`,
    fragmentShader: `uniform vec3 uInk; uniform vec3 uHot; uniform float uGain; uniform float uStreamGain;
      varying vec2 vUv; varying float vAlpha; varying float vLand; varying float vHead; varying float vGlow;
      void main(){
        vec2 w=fwidth(vUv)+.001;
        float sides=smoothstep(0.,w.y,vUv.y)*smoothstep(0.,w.y,1.-vUv.y);
        float ends=smoothstep(0.,w.x,vUv.x)*smoothstep(0.,w.x,1.-vUv.x);
        // A streak is a fading tail with a hot head; a landed cell is solid, lit a touch from above.
        float streak=pow(vUv.x,1.7)*smoothstep(0.,w.x,1.-vUv.x);
        float a=mix(streak,ends,vLand)*sides;
        float heat=pow(vUv.x,12.)*vHead*(1.-vLand)+vGlow+vLand*.1*vUv.y;
        gl_FragColor=vec4(mix(uInk,uHot,clamp(heat,0.,1.)),min(1.,vAlpha*a*uGain*mix(uStreamGain,1.,vLand)));
      }` });
  const bars = new Mesh(geometry, material);
  bars.frustumCulled = false;
  scene.add(bars);

  const theme = () => {
    // Raw shader output is written as-is, so keep the CSS color's sRGB numbers instead of converting to linear.
    ink.setStyle(getComputedStyle(host).color, LinearSRGBColorSpace);
    const light = document.documentElement.dataset.theme === "light";
    // Dark: streaks add light where they cross and heads run white-hot. Light: plain ink, heads deepen.
    hot.copy(ink).lerp(light ? new Color(0, 0, 0) : new Color(1, .97, .86), light ? .22 : .6);
    material.blending = light ? NormalBlending : AdditiveBlending;
    // On white, long streaks read heavier than the same light on black, so the stream is lighter there.
    uniforms.uGain.value = light ? 1.25 : 1; uniforms.uStreamGain.value = light ? .6 : 1;
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
  const duration = 3400;
  const smooth = (a: number, b: number, t: number) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
  // Speed up (0–300 ms), fly in and land (200–1000), sweep (1000–1500), hold, leave (2400–3400).
  const timeline = (t: number) => {
    uniforms.uBoost.value = .6 + 5.4 * smooth(0, 300, t) * (1 - smooth(300, 900, t)) + 1.8 * smooth(2400, 2700, t) * (1 - smooth(2700, 3400, t));
    const leaving = t >= 2400;
    uniforms.uRelease.value = leaving ? 1 : 0;
    uniforms.uForm.value = leaving ? 1 - smooth(2400, 3300, t) : smooth(200, 1000, t);
    uniforms.uSweep.value = -.3 + 1.7 * smooth(1000, 1550, t);
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
  // Reduced motion: a still frame of the landed mark in its stream.
  function still() {
    uniforms.uTravel.value = 3; uniforms.uBoost.value = .6;
    uniforms.uForm.value = 1; uniforms.uRelease.value = 0; uniforms.uSweep.value = -1; render();
  }
  function replay() {
    if (disposed || lost || paused) return;
    if (reduced) { still(); onRunning(false); return; }
    elapsed = 0; active = true; timeline(0); onRunning(true); resume();
  }
  // Frame the mark in the space under the copy ([data-scene-text]), and dim the stream behind the copy.
  function fit() {
    if (disposed || lost) return;
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight), aspect = width / height;
    camera.aspect = aspect; camera.updateProjectionMatrix();
    uniforms.uAspect.value = aspect;
    const visibleHeight = 2 * camZ * uniforms.uTanHalf.value, perPx = visibleHeight / height;
    const text = zone.querySelector<HTMLElement>("[data-scene-text]");
    const textBottom = text ? Math.max(0, text.getBoundingClientRect().bottom - host.getBoundingClientRect().top) : 0;
    const top = textBottom + 24, bottom = height - 56, room = Math.max(120, bottom - top);
    uniforms.uScale.value = Math.min(room * .7 * perPx / 44, visibleHeight * aspect * .62 / 72);
    uniforms.uMarkY.value = (height / 2 - (top + room / 2)) * perPx;
    uniforms.uTextFrac.value = textBottom / height;
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
