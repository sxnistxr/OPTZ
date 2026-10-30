import {
  WebGLRenderer, Scene, OrthographicCamera, BufferGeometry, Float32BufferAttribute,
  ShaderMaterial, LineSegments, Points, Group, Mesh, MeshStandardMaterial,
  ExtrudeGeometry, Shape, AmbientLight, DirectionalLight, CanvasTexture,
  MeshBasicMaterial, PlaneGeometry, SRGBColorSpace,
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
  try { renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" }); }
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
  const geometry = keep(new BufferGeometry());
  const vertices: number[] = [], lanes: number[] = [], progress: number[] = [];
  for (let lane = 0; lane < count; lane++) {
    for (let j = 0; j < steps; j++) {
      for (const k of [j, j + 1]) {
        const t = k / steps, l = lane / (count - 1), p = trailPoint(t, l, mode);
        vertices.push(p.x, p.y, -2); lanes.push(l); progress.push(t);
      }
    }
  }
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("aLane", new Float32BufferAttribute(lanes, 1));
  geometry.setAttribute("aProgress", new Float32BufferAttribute(progress, 1));
  const uniforms = {
    uTime: { value: 0 }, uHead: { value: 1 }, uPhase: { value: 0 },
    uSeed: { value: 0 }, uHeightScale: { value: 1 }, uMode: { value: mode === "speed" ? 1 : 0 },
  };
  const lines = keep(new ShaderMaterial({ transparent: true, depthWrite: false, uniforms,
    vertexShader: `attribute float aLane; attribute float aProgress;
      uniform float uTime; uniform float uSeed; uniform float uHeightScale; uniform float uMode;
      varying float vLane; varying float vProgress;
      ${trailCurveGLSL}
      void main(){vLane=aLane;vProgress=aProgress;
        vec2 p=trailPosition(aProgress,aLane,uMode,uSeed,uTime);
        p.y=200.+(p.y-200.)*uHeightScale;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,-2.,1.);}`,
    fragmentShader: `uniform float uHead; uniform float uPhase; varying float vLane; varying float vProgress;
      void main(){
        float pulse=pow(max(0.,cos((vProgress-uPhase)*12.56637+vLane*.5)),16.);
        float ink=.14+.28*pow(sin(vLane*93.)*.5+.5,5.);
        float edge=smoothstep(0.,.06,vProgress)*(1.-smoothstep(.94,1.,vProgress));
        float lane=.45+.55*sin(vLane*3.14159);
        float head=1.-smoothstep(uHead-.015,uHead+.025,vProgress);
        gl_FragColor=vec4(1.,.84,.32,(ink+pulse*.28)*edge*lane*head);}` }));
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
        gl_Position=projectionMatrix*modelViewMatrix*vec4(p,2.,1.);
        gl_PointSize=(1.5+pow(lane,5.)*2.)*uRatio;
        vAlpha=(.15+lane*.45)*smoothstep(0.,.08,t)*(1.-smoothstep(.9,1.,t))
          *(1.-smoothstep(uHead-.015,uHead+.025,t));}`,
    fragmentShader: `varying float vAlpha;void main(){
      float alpha=1.-smoothstep(.12,.5,length(gl_PointCoord-vec2(.5)));
      gl_FragColor=vec4(1.,.89,.48,vAlpha*alpha);}` }));
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
      packet.position.set(p.x, 200 + (p.y - 200) * uniforms.uHeightScale.value, 8);
      packet.rotation.z = Math.atan2((n.y - p.y) * uniforms.uHeightScale.value, n.x - p.x);
      packet.rotation.x = -.1 + Math.sin(clock * .55) * .025;
      packet.rotation.y = Math.sin(clock * .4) * .035;
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
  fit(); host.classList.add("webgl-ready"); if (!reduced) replay(); else onRunning(false);
  return {
    replay,
    setReduced(value) {
      reduced = value;
      if (value) { stop(); active = false; onRunning(false); render(); } else resume();
    },
    setPaused(value) { paused = value; if (value) stop(); else resume(); },
    dispose() {
      disposed = true; stop(); resize.disconnect(); observer.disconnect();
      document.removeEventListener("visibilitychange", visibility);
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", contextRestored);
      resources.forEach(r => r.dispose()); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); host.classList.remove("webgl-ready");
    },
  };
}
