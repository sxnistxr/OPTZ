import {
  WebGLRenderer, Scene, OrthographicCamera, BufferGeometry, Float32BufferAttribute,
  ShaderMaterial, LineSegments, Points, Group, Mesh, MeshStandardMaterial,
  ExtrudeGeometry, Shape, AmbientLight, DirectionalLight, CanvasTexture,
  MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Color, Vector2, Vector3,
} from "three";
import { trailPoint, trailCurveGLSL } from "./trail-geometry";

export interface TrailController {
  replay(): void;
  setReduced(value: boolean): void;
  setPaused(value: boolean): void;
  dispose(): void;
}

export function createTrail(host: HTMLElement, mode: "flow" | "speed", reduced: boolean,
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
    uTime: { value: 0 }, uHead: { value: 1 }, uPhase: { value: 0 },
    uSeed: { value: 0 }, uHeightScale: { value: 1 }, uMode: { value: mode === "speed" ? 1 : 0 },
    uTilt: { value: new Vector2() }, uPointer: { value: new Vector3(500, 200, 0) },
    uInk: { value: ink }, uSpark: { value: spark }, uGain: { value: 1 },
  };
  const lines = keep(new ShaderMaterial({ transparent: true, depthWrite: false, uniforms,
    vertexShader: `uniform float uTime; uniform float uSeed; uniform float uHeightScale; uniform float uMode;
      varying float vLane; varying float vProgress;
      ${trailCurveGLSL}
      void main(){vProgress=position.x;vLane=position.y;
        vec2 p=trailPosition(vProgress,vLane,uMode,uSeed,uTime);
        p.y=200.+(p.y-200.)*uHeightScale;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(trailField(p,vLane),-2.,1.);}`,
    fragmentShader: `uniform float uHead; uniform float uPhase; uniform vec3 uInk; uniform float uGain;
      varying float vLane; varying float vProgress;
      void main(){
        float pulse=pow(max(0.,cos((vProgress-uPhase)*12.56637+vLane*.5)),16.);
        float ink=.14+.28*pow(sin(vLane*93.)*.5+.5,5.);
        float edge=smoothstep(0.,.06,vProgress)*(1.-smoothstep(.94,1.,vProgress));
        float lane=.45+.55*sin(vLane*3.14159);
        float head=1.-smoothstep(uHead-.015,uHead+.025,vProgress);
        gl_FragColor=vec4(uInk,min(1.,(ink+pulse*.28)*edge*lane*head*uGain));}` }));
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
      uniform float uSeed; uniform float uMode; uniform float uHeightScale; uniform float uRatio; uniform float uHead;
      varying float vAlpha;
      ${trailCurveGLSL}
      void main(){float t=fract(aSeed.x+uPhase);float lane=aSeed.y;
        vec2 p=trailPosition(t,lane,uMode,uSeed,uTime);p.y=200.+(p.y-200.)*uHeightScale;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(trailField(p,lane),2.,1.);
        gl_PointSize=(1.5+pow(lane,5.)*2.)*uRatio;
        vAlpha=(.15+lane*.45)*smoothstep(0.,.08,t)*(1.-smoothstep(.9,1.,t))
          *(1.-smoothstep(uHead-.015,uHead+.025,t));}`,
    fragmentShader: `uniform vec3 uSpark; uniform float uGain; varying float vAlpha;void main(){
      float alpha=1.-smoothstep(.12,.5,length(gl_PointCoord-vec2(.5)));
      gl_FragColor=vec4(uSpark,min(1.,vAlpha*alpha*uGain));}` }));
  const points = new Points(particles, sparks);
  points.frustumCulled = false;
  scene.add(points);

  const packet = new Group();
  if (mode === "speed") {
    const shape = new Shape(); const w = 93, h = 40, r = 9;
    shape.moveTo(-w / 2 + r, -h / 2); shape.lineTo(w / 2 - r, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r); shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); shape.lineTo(-w / 2 + r, h / 2);
    shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); shape.lineTo(-w / 2, -h / 2 + r); shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const body = keep(new ExtrudeGeometry(shape, { depth: 6, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 1.5, bevelThickness: 1.5, curveSegments: 12 }));
    packet.add(new Mesh(body, keep(new MeshStandardMaterial({ color: 0xffdf51, roughness: .45, metalness: .08 }))));
    const label = document.createElement("canvas"); label.width = 512; label.height = 160;
    const ctx = label.getContext("2d")!;
    ctx.fillStyle = "#171717"; ctx.font = "600 52px monospace"; ctx.textBaseline = "middle"; ctx.fillText("200 OK", 23, 82);
    ctx.beginPath(); ctx.ellipse(385, 80, 6, 11, 0, 0, Math.PI * 2); ctx.ellipse(425, 80, 6, 11, 0, 0, Math.PI * 2); ctx.fill();
    const texture = keep(new CanvasTexture(label)); texture.colorSpace = SRGBColorSpace;
    const face = new Mesh(keep(new PlaneGeometry(86, 29)), keep(new MeshBasicMaterial({ map: texture, transparent: true })));
    face.position.z = 8; packet.add(face); scene.add(packet);
    scene.add(new AmbientLight(0xffffff, 2));
    const light = new DirectionalLight(0xffffff, 2.5); light.position.set(200, 400, 500); scene.add(light);
  }

  // Ink follows the theme through the viewport's CSS color: no filter on the canvas, which would cost a composite.
  const theme = () => {
    ink.setStyle(getComputedStyle(host).color);
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
  const duration = mode === "speed" ? 2400 : 1400;
  const p = { x: 0, y: 0 }, n = { x: 0, y: 0 };
  const ease = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  const render = () => {
    if (disposed || lost) return;
    const t = active ? Math.min(elapsed / duration, 1) : 1;
    const travel = active ? -.045 + .875 * ease(t) : .83;
    uniforms.uSeed.value = seedFrom + (seedTo - seedFrom) * ease(t);
    uniforms.uHead.value = mode === "speed" ? Math.max(0, travel + .025) : 1;
    uniforms.uTime.value = clock; uniforms.uPhase.value = particlePhase;
    if (mode === "speed") {
      trailPoint(travel, .5, mode, 0, clock, p);
      trailPoint(travel + .002, .5, mode, 0, clock, n);
      packet.position.set(p.x + tilt.x * 4, 200 + (p.y - 200) * uniforms.uHeightScale.value - tilt.y * 2, 8);
      packet.rotation.z = Math.atan2((n.y - p.y) * uniforms.uHeightScale.value, n.x - p.x);
      packet.rotation.x = -.1 + Math.sin(clock * .55) * .025 + tilt.y * .18;
      packet.rotation.y = Math.sin(clock * .4) * .035 + tilt.x * .28;
    }
    renderer.render(scene, camera);
  };
  function tick(now: number) {
    frame = 0;
    if (disposed || lost || !visible || document.hidden || reduced || paused) return;
    const delta = Math.min(now - last, 50) / 1000; last = now;
    clock += delta;
    if (active) elapsed += delta * 1000;
    const t = active ? Math.min(elapsed / duration, 1) : 1;
    particlePhase = (particlePhase + delta * (.045 + (active && mode === "speed" ? Math.sin(t * Math.PI) * .1 : 0))) % 1;
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
    if (mode === "flow") { seedFrom = uniforms.uSeed.value; seedTo = ++seed * .7; }
    active = !reduced; onRunning(active); render(); resume();
  }
  function fit() {
    if (disposed || lost) return;
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
    const worldHeight = 1000 * height / width;
    camera.top = 200 + worldHeight / 2; camera.bottom = 200 - worldHeight / 2;
    camera.updateProjectionMatrix();
    uniforms.uHeightScale.value = worldHeight / 400;
    const packetHeight = width < 600 ? 29 : 36;
    packet.scale.setScalar(packetHeight / 40 * 1000 / width);
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
