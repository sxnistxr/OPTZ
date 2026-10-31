import {
  WebGLRenderer, Scene, PerspectiveCamera, InstancedBufferGeometry, InstancedBufferAttribute,
  Float32BufferAttribute, ShaderMaterial, Mesh, Color, AdditiveBlending, NormalBlending,
} from "three";
import { markLines, hash } from "./speed-geometry";
import type { TrailController } from "./trail-scene";

/**
 * "Served from memory": light trails stream behind the hero. A request speeds the stream up, then the
 * mark's lines brake in from the left, flash as they land, are swept with light, and speed away to the
 * right. Everything moves left to right, the direction of the stream.
 *
 * Every trail, speck and mark line is one instance of a quad. The vertex shader sizes each quad in
 * screen pixels (never thinner than one, fading instead, so hairlines do not shimmer) with room for a
 * glow; the fragment shader draws a capsule with a fading tail into it. No post-processing pass.
 */
const STREAM = 0, DUST = 1, MARK = 2;

export function createSpeed(host: HTMLElement, reduced: boolean,
  onRunning: (running: boolean) => void, onFailure: () => void): TrailController | null {
  let renderer: WebGLRenderer;
  try { renderer = new WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" }); }
  catch { return null; }
  // Fill rate grows with the pixel ratio squared, and every trail is a transparent quad.
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  const scene = new Scene();
  const camZ = 120, fov = 30;
  const camera = new PerspectiveCamera(fov, 1, 1, 500);
  camera.position.z = camZ;

  const lines = markLines();
  const mobile = host.clientWidth < 600;
  const trails = mobile ? 170 : 380, specks = mobile ? 60 : 130;
  const count = lines.length + trails + specks;
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.instanceCount = count;
  const stream = new Float32Array(count * 4), target = new Float32Array(count * 4), meta = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const line = lines[i], kind = line ? MARK : i < lines.length + trails ? STREAM : DUST;
    // Depth skews far: most of the stream is fine and dim, a few trails pass close.
    const depth = Math.pow(hash(i * 3 + 1), 1.5);
    // Stream: normalised y, depth z (nearer is faster), speed, phase along the span.
    stream.set([hash(i * 3 + 2) - .5, -90 + depth * 102, (kind === DUST ? 2 : 6) + depth * (kind === DUST ? 6 : 22) + hash(i * 7) * 5, hash(i * 5 + 3)], i * 4);
    if (line) target.set([line.x, line.y, line.w, line.h], i * 4);
    // Meta: kind, arrival order (by the line's left end, with jitter), lean, a random look.
    meta.set([kind, line ? (line.x - line.w / 2 + 36) / 72 * .85 + hash(i * 11) * .15 : 0, line ? line.s : 0, hash(i * 13 + 5)], i * 4);
  }
  geometry.setAttribute("aStream", new InstancedBufferAttribute(stream, 4));
  geometry.setAttribute("aTarget", new InstancedBufferAttribute(target, 4));
  geometry.setAttribute("aMeta", new InstancedBufferAttribute(meta, 4));
  const ink = new Color(), hot = new Color(), white = new Color(1, .97, .88), black = new Color(0, 0, 0);
  const uniforms = {
    uTravel: { value: 0 }, uBoost: { value: 1 }, uWarp: { value: 0 }, uT: { value: 99 }, uTime: { value: 0 },
    uScale: { value: .5 }, uMarkY: { value: 0 }, uTextFrac: { value: 0 },
    uAspect: { value: 1 }, uTanHalf: { value: Math.tan(fov * Math.PI / 360) }, uCamZ: { value: camZ }, uViewH: { value: 1 }, uDpr: { value: 1 },
    uInk: { value: ink }, uHot: { value: hot }, uGain: { value: 1 }, uGlow: { value: .55 },
  };
  const material = new ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, uniforms,
    vertexShader: `attribute vec4 aStream; attribute vec4 aTarget; attribute vec4 aMeta;
      uniform float uTravel; uniform float uBoost; uniform float uWarp; uniform float uT; uniform float uTime;
      uniform float uScale; uniform float uMarkY; uniform float uTextFrac;
      uniform float uAspect; uniform float uTanHalf; uniform float uCamZ; uniform float uViewH; uniform float uDpr;
      varying vec2 vP; varying float vHalfLen; varying float vHalfThick; varying float vGlowR;
      varying float vTail; varying float vAlpha; varying float vHeat; varying float vFlare; varying float vMark; varying float vFlareR; varying float vRoomR;
      void main(){
        float z=aStream.y, height=2.*(uCamZ-z)*uTanHalf, span=height*uAspect+60.;
        float px=uViewH/height;                                   // device pixels per world unit at this depth
        float near=smoothstep(-90.,12.,z), rnd=aMeta.w;
        float isMark=step(1.5,aMeta.x), isDust=step(.5,aMeta.x)*(1.-isMark), lead=step(.9,rnd)*(1.-isDust)*(1.-isMark);
        float x=mod(aStream.w*span+uTravel*aStream.z,span)-span*.5;
        vec2 centre=vec2(x,aStream.x*height);
        // Warp: while the stream speeds up it spreads out from the mark, a field-of-view kick for the stream alone.
        vec2 focus=vec2(0.,uMarkY*(uCamZ-z)/uCamZ);
        centre=focus+(centre-focus)*(1.+uWarp*.16);
        float len=(1.4+near*8.)*(.55+uBoost*.45)*(1.+lead*.9)*(1.-isDust);
        float thick=mix(.85,1.9,near)*(1.+lead*.35)*(1.+isDust*.5)*uDpr;
        float tail=1., alpha=(.07+.5*near)*(1.+lead*.7), heat=lead*.25, flare=lead;
        alpha*=1.-smoothstep(.36,.5,abs(x/span));
        if(isDust>.5){ tail=0.; alpha*=.55+.45*sin(uTime*1.7+rnd*40.); }
        if(isMark>.5){
          z=0.; px=uViewH/(2.*uCamZ*uTanHalf); span=2.*uCamZ*uTanHalf*uAspect+60.;
          // Arrive: brake in from the left (ease-out quart). Leave: speed away to the right (ease-in cubic).
          float start=.1+aMeta.y*.45, p=clamp((uT-start)/.8,0.,1.);
          float braking=pow(1.-p,3.)*step(.0001,p), arrive=1.-pow(1.-p,4.);
          float leaving=clamp((uT-2.6-(1.-aMeta.y)*.25)/.55,0.,1.), go=leaving*leaving*leaving;
          vec2 slot=aTarget.xy*uScale+vec2(0.,uMarkY);
          float body=aTarget.z*uScale, enter=-span*.5-body, away=span*.5+body-slot.x;
          float head=mix(enter,slot.x,arrive)+go*away;
          // The afterglow behind a line grows with its speed: long while braking or leaving, none at rest.
          float glowTail=(slot.x-enter)*.3*braking+away*.25*3.*leaving*leaving;
          len=body+glowTail; centre=vec2(head-glowTail*.5,slot.y);
          thick=max(aTarget.w*uScale*px,1.);
          tail=glowTail/len;
          float landed=step(start+.8,uT);
          heat=landed*exp(-max(0.,uT-start-.8)*5.)*.8                                      // flash on landing
            +landed*exp(-pow((aMeta.y-(uT-1.45)/.5)*4.,2.));                                 // sweep across the mark
          flare=braking*1.5+leaving;
          alpha=step(.0001,p)*(1.-step(.999,leaving));
        }
        // Phone-wire: never thinner than a pixel; a thinner line is drawn at a pixel and fades instead.
        float thickPx=max(thick,1.); alpha*=min(1.,thick);
        float flareR=thickPx*1.25+1., glowR=(thickPx*2.2+2.*uDpr)*mix(1.,.5,isMark), lenPx=len*px;
        // The quad has to hold the whole head flare, not just the glow. Light it clipped showed as a hard-edged block.
        float roomR=max(glowR,flareR*4.*step(.001,flare));
        vec2 quad=vec2(lenPx+roomR*2.,thickPx+roomR*2.);
        vec2 local=position.xy*quad/px; local.x+=aMeta.z*local.y;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(centre+local,z,1.);
        // Dim behind the copy and toward the bottom of the hero; the landed mark stays whole.
        float sy=.5-.5*gl_Position.y/gl_Position.w;
        float screen=(1.-smoothstep(.86,1.,sy))*mix(.12,1.,smoothstep(uTextFrac-.1,uTextFrac+.03,sy));
        alpha*=mix(screen,1.,isMark);
        vP=position.xy*quad; vHalfLen=lenPx*.5; vHalfThick=thickPx*.5; vGlowR=glowR;
        vTail=tail; vAlpha=alpha; vHeat=heat; vFlare=flare; vMark=isMark; vFlareR=flareR; vRoomR=roomR;
      }`,
    fragmentShader: `uniform vec3 uInk; uniform vec3 uHot; uniform float uGain; uniform float uGlow;
      varying vec2 vP; varying float vHalfLen; varying float vHalfThick; varying float vGlowR;
      varying float vTail; varying float vAlpha; varying float vHeat; varying float vFlare; varying float vMark; varying float vFlareR; varying float vRoomR;
      void main(){
        // Capsule distance in pixels, an antialiased core, and a glow that falls off around it.
        float d=length(vec2(max(abs(vP.x)-vHalfLen,0.),vP.y));
        float core=1.-smoothstep(vHalfThick-.6,vHalfThick+.6,d);
        // Every falloff is windowed to reach zero at the quad's edge, so no light ends on a straight line.
        float glow=exp(-d/(vGlowR*.42))*uGlow*(1.-smoothstep(.5*vGlowR,vGlowR,d));
        // 0 at the tail end, 1 at the head: the tail fraction of the length fades out.
        float along=clamp((vP.x+vHalfLen)/max(2.*vHalfLen,.001),0.,1.);
        float body=pow(clamp(along/max(vTail,.0001),0.,1.),1.6);
        float fd=length(vP-vec2(vHalfLen,0.));
        float flare=exp(-fd/vFlareR)*(1.-smoothstep(.5*vRoomR,vRoomR,fd))*vFlare;
        float light=(core+glow)*body+flare*.8;
        // Trails run white-hot in the core; the landed mark stays gold unless the flash or sweep lights it.
        vec3 c=mix(uInk,uHot,clamp(core*body*(mix(.25,.04,vMark)+vHeat)+flare,0.,1.));
        // Half a step of noise breaks the 8-bit banding of soft additive glow.
        float dither=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)/255.;
        float a=clamp(light*vAlpha*uGain+dither,0.,1.);
        if(a<.002) discard;
        gl_FragColor=vec4(c,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const field = new Mesh(geometry, material);
  field.frustumCulled = false;
  scene.add(field);

  const theme = () => {
    // Colors stay linear in the shader and are encoded on output by <colorspace_fragment>.
    ink.setStyle(getComputedStyle(host).color);
    const light = document.documentElement.dataset.theme === "light";
    // Dark: trails add light where they cross and their cores run white-hot. Light: ink on paper, cores deepen.
    hot.copy(ink).lerp(light ? black : white, light ? .3 : .75);
    const blending = light ? NormalBlending : AdditiveBlending;
    // Blending is compiled into the program, so a change needs a rebuild.
    if (material.blending !== blending) { material.blending = blending; material.needsUpdate = true; }
    uniforms.uGain.value = light ? .85 : 1; uniforms.uGlow.value = light ? .18 : .55;
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

  let running = false, active = false, paused = false, visible = true, disposed = false, lost = false, last = 0;
  const duration = 3.55;
  // Speed targets over a request: a burst as it arrives, cruising while the mark holds, a push as it leaves.
  const boostTarget = (t: number) => !active ? 1 : t < .5 ? 5.5 : t >= 2.55 && t < 3.25 ? 3.2 : 1;
  const render = () => {
    if (disposed || lost) return;
    camera.position.set(tilt.x * 7, -tilt.y * 4, camZ); camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  };
  // Frames come from renderer.setAnimationLoop, as three.js advises over a hand-rolled requestAnimationFrame.
  function tick(now: number) {
    if (disposed || lost || !visible || document.hidden || reduced || paused) { stop(); return; }
    const delta = Math.min(Math.max(now - last, 0), 50) / 1000; last = now;
    if (active) { uniforms.uT.value += delta; if (uniforms.uT.value >= duration) { active = false; uniforms.uT.value = 99; onRunning(false); } }
    // Frame-rate independent easing toward each target, as in the Codrops light-trails demo.
    uniforms.uBoost.value += (boostTarget(uniforms.uT.value) - uniforms.uBoost.value) * (1 - Math.exp(-delta * 7));
    uniforms.uWarp.value = Math.min(1, Math.max(0, (uniforms.uBoost.value - 1) / 4.5));
    uniforms.uTravel.value += delta * uniforms.uBoost.value;
    uniforms.uTime.value += delta;
    const k = 1 - Math.exp(-delta * 4);
    tilt.x += (aim.x - tilt.x) * k; tilt.y += (aim.y - tilt.y) * k;
    render();
  }
  function resume() {
    if (!disposed && !reduced && !paused && visible && !document.hidden && !lost && !running) {
      last = performance.now(); running = true; renderer.setAnimationLoop(tick);
    }
  }
  function stop() { running = false; renderer.setAnimationLoop(null); }
  // Reduced motion: a still frame of the landed mark in its stream.
  function still() {
    uniforms.uTravel.value = 3; uniforms.uBoost.value = 1; uniforms.uWarp.value = 0; uniforms.uT.value = 2.2; render();
  }
  function replay() {
    if (disposed || lost || paused || !ready) return;
    if (reduced) { still(); onRunning(false); return; }
    uniforms.uT.value = 0; active = true; onRunning(true); resume();
  }
  // Frame the mark in the space under the copy ([data-scene-text]), and dim the stream behind the copy.
  function fit() {
    if (disposed || lost) return;
    const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight), aspect = width / height;
    camera.aspect = aspect; camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    uniforms.uAspect.value = aspect;
    uniforms.uViewH.value = height * renderer.getPixelRatio(); uniforms.uDpr.value = renderer.getPixelRatio();
    const visibleHeight = 2 * camZ * uniforms.uTanHalf.value, perPx = visibleHeight / height;
    const text = zone.querySelector<HTMLElement>("[data-scene-text]");
    const textBottom = text ? Math.max(0, text.getBoundingClientRect().bottom - host.getBoundingClientRect().top) : 0;
    const top = textBottom + 24, bottom = height - 56, room = Math.max(120, bottom - top);
    uniforms.uScale.value = Math.min(room * .7 * perPx / 44, visibleHeight * aspect * .62 / 72);
    uniforms.uMarkY.value = (height / 2 - (top + room / 2)) * perPx;
    uniforms.uTextFrac.value = textBottom / height;
    render();
  }
  const resize = new ResizeObserver(fit); resize.observe(host);
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) resume(); else stop(); }); observer.observe(host);
  const visibility = () => { if (document.hidden) stop(); else resume(); }; document.addEventListener("visibilitychange", visibility);
  const contextLost = (e: Event) => { e.preventDefault(); lost = true; stop(); host.classList.remove("webgl-ready"); onFailure(); };
  const contextRestored = () => { lost = false; onRunning(active); fit(); host.classList.add("webgl-ready"); resume(); };
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  renderer.domElement.addEventListener("webglcontextrestored", contextRestored);
  const themeWatch = new MutationObserver(theme); themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  // Build the program before the first frame; until then the static SVG stays in place.
  let ready = false;
  theme(); fit();
  const compiled = renderer.extensions.has("KHR_parallel_shader_compile")
    ? renderer.compileAsync(scene, camera).catch(() => {}) : Promise.resolve(renderer.compile(scene, camera));
  compiled.then(() => {
    if (disposed || lost) return;
    ready = true; fit(); host.classList.add("webgl-ready");
    if (reduced) { still(); onRunning(false); } else replay();
  });
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
