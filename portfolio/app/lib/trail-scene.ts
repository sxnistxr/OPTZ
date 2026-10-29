import {
  WebGLRenderer, Scene, OrthographicCamera, BufferGeometry, Float32BufferAttribute,
  ShaderMaterial, LineSegments, Points, Group, Mesh, MeshStandardMaterial,
  ExtrudeGeometry, Shape, AmbientLight, DirectionalLight, CanvasTexture,
  MeshBasicMaterial, PlaneGeometry, SRGBColorSpace,
} from "three";
import { trailPoint } from "./trail-geometry";

export interface TrailController { replay(): void; setReduced(value: boolean): void; dispose(): void; }
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
  const geometry = keep(new BufferGeometry());
  const vertices: number[] = [], lanes: number[] = [], progress: number[] = [];
  const count = host.clientWidth < 600 ? 90 : 150;
  const steps = 150;
  function build(seed: number) {
    vertices.length = 0; lanes.length = 0; progress.length = 0;
    for (let lane = 0; lane < count; lane++) {
      for (let j = 0; j < steps; j++) {
        for (const k of [j,j+1]) {
          const t = k / steps, p = trailPoint(t, lane / (count-1), mode, seed);
          vertices.push(p.x, p.y, -2); lanes.push(lane / count); progress.push(t);
        }
      }
    }
    geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
    geometry.setAttribute("aLane", new Float32BufferAttribute(lanes, 1));
    geometry.setAttribute("aProgress", new Float32BufferAttribute(progress, 1));
    geometry.computeBoundingSphere();
  }
  build(0);
  const uniforms = { uTime: { value: 0 }, uHead: { value: 1 }, uMotion: { value: 0 }, uSeed: { value: 0 } };
  const lines = keep(new ShaderMaterial({ transparent: true, depthWrite: false, uniforms,
    vertexShader: `attribute float aLane; attribute float aProgress; varying float vLane; varying float vProgress;
      void main(){vLane=aLane;vProgress=aProgress;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform float uTime; uniform float uHead; uniform float uMotion; varying float vLane; varying float vProgress;
      void main(){float pulse=pow(max(0.,sin(vProgress*35.-uTime*9.+vLane*20.)),18.);
      float ink=.22+.4*pow(sin(vLane*93.)*.5+.5,5.);
      float head=1.-smoothstep(uHead-.02,uHead+.015,vProgress);
      gl_FragColor=vec4(vec3(1.,.83,.28), (ink+pulse*.55*uMotion)*head);}` }));
  scene.add(new LineSegments(geometry, lines));
  const particles = keep(new BufferGeometry());
  const positions: number[] = [], seeds: number[] = [];
  for (let i=0;i<300;i++) { positions.push(0,0,0); seeds.push(((i*73)%301)/301,((i*41)%307)/307); }
  particles.setAttribute("position",new Float32BufferAttribute(positions,3));
  particles.setAttribute("aSeed",new Float32BufferAttribute(seeds,2));
  const sparks = keep(new ShaderMaterial({ transparent: true, depthWrite: false,
    uniforms: { ...uniforms, uFlow: {value: mode === "flow" ? 1 : 0}, uRatio:{value:renderer.getPixelRatio()} },
    vertexShader: `attribute vec2 aSeed; uniform float uTime; uniform float uMotion; uniform float uFlow; uniform float uRatio; uniform float uSeed; varying float vAlpha;
      void main(){float t=fract(aSeed.x+uTime*.13*uMotion);float lane=aSeed.y;
      float envelope=pow(max(0.,1.-t),.8);
      float speed=205.-100.*sin(t*3.14159*1.35-.3)+(lane-.5)*260.*envelope+sin(t*13.+lane*5.)*45.*envelope;
      float flow=205.+sin(t*3.14159*4.3+uSeed)*(58.+38.*cos(lane*5.))+sin(t*12.+lane*5.+uSeed)*40.+(lane-.5)*110.;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(-60.+t*1120.,mix(speed,flow,uFlow),2.,1.);
      gl_PointSize=(1.+pow(lane,6.)*3.)*uRatio;vAlpha=.25+lane*.6;}`,
    fragmentShader: `varying float vAlpha;void main(){gl_FragColor=vec4(1.,.88,.4,vAlpha);}` }));
  scene.add(new Points(particles,sparks));
  const packet = new Group();
  if (mode === "speed") {
    const shape = new Shape(); const w=93,h=40,r=10;
    shape.moveTo(-w/2+r,-h/2);shape.lineTo(w/2-r,-h/2);shape.quadraticCurveTo(w/2,-h/2,w/2,-h/2+r);
    shape.lineTo(w/2,h/2-r);shape.quadraticCurveTo(w/2,h/2,w/2-r,h/2);shape.lineTo(-w/2+r,h/2);
    shape.quadraticCurveTo(-w/2,h/2,-w/2,h/2-r);shape.lineTo(-w/2,-h/2+r);shape.quadraticCurveTo(-w/2,-h/2,-w/2+r,-h/2);
    const body=keep(new ExtrudeGeometry(shape,{depth:9,bevelEnabled:true,bevelSegments:3,steps:1,bevelSize:2,bevelThickness:2,curveSegments:8}));
    packet.add(new Mesh(body,keep(new MeshStandardMaterial({color:0xffdf51,roughness:.32,metalness:.12}))));
    const label=document.createElement("canvas");label.width=512;label.height=160;
    const ctx=label.getContext("2d")!;ctx.fillStyle="#171717";ctx.font="600 52px monospace";ctx.textBaseline="middle";ctx.fillText("200 OK",23,82);
    ctx.fillRect(376,53,17,39);ctx.fillRect(420,53,17,39);
    const texture=keep(new CanvasTexture(label));texture.colorSpace=SRGBColorSpace;
    const face=new Mesh(keep(new PlaneGeometry(86,29)),keep(new MeshBasicMaterial({map:texture,transparent:true})));face.position.z=12;packet.add(face);
    packet.rotation.x=-.12;scene.add(packet);
    scene.add(new AmbientLight(0xffffff,2));const light=new DirectionalLight(0xffffff,3);light.position.set(200,400,500);scene.add(light);
  }
  let frame=0, active=false, visible=true, disposed=false, lost=false, elapsed=0, last=0, seed=0;
  const duration=3600;
  const render = () => {
    if(disposed||lost)return;
    const t = active ? Math.min(elapsed/duration,1) : 1;
    const travel = active ? .03+.83*(1-Math.pow(1-t,2.4)) : .86;
    uniforms.uHead.value=mode === "speed" ? travel+.025 : 1;
    uniforms.uTime.value=elapsed/1000; uniforms.uMotion.value=active ? 1 : 0;
    if(mode === "speed") { const p=trailPoint(travel,.5,"speed");const n=trailPoint(travel+.005,.5,"speed");packet.position.set(p.x,p.y,8);packet.rotation.z=Math.atan2(n.y-p.y,n.x-p.x); }
    renderer.render(scene,camera);
  };
  function tick(now:number) { frame=0;if(disposed||lost||!visible||document.hidden||!active)return;
    elapsed+=Math.min(now-last,50);last=now;
    if(elapsed>=duration){active=false;onRunning(false);} render();
    if(active)frame=requestAnimationFrame(tick);
  }
  function resume(){if(active&&visible&&!document.hidden&&!lost&&!frame){last=performance.now();frame=requestAnimationFrame(tick);}}
  function stop(){cancelAnimationFrame(frame);frame=0;}
  function replay(){if(disposed||lost)return;stop();elapsed=0;if(mode==="flow"){uniforms.uSeed.value=++seed*.6;build(uniforms.uSeed.value);}active=!reduced;onRunning(active);render();resume();}
  const resize=new ResizeObserver(()=>{if(disposed||lost)return;renderer.setSize(Math.max(1,host.clientWidth),Math.max(1,host.clientHeight),false);render();});resize.observe(host);
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)resume();else stop();});observer.observe(host);
  const visibility=()=>{if(document.hidden)stop();else resume();};document.addEventListener("visibilitychange",visibility);
  const contextLost=(e:Event)=>{e.preventDefault();lost=true;stop();host.classList.remove("webgl-ready");onFailure();};
  const contextRestored=()=>{lost=false;active=false;onRunning(false);render();host.classList.add("webgl-ready");};
  renderer.domElement.addEventListener("webglcontextlost",contextLost);renderer.domElement.addEventListener("webglcontextrestored",contextRestored);
  renderer.setSize(Math.max(1,host.clientWidth),Math.max(1,host.clientHeight),false);
  render();host.classList.add("webgl-ready");if(!reduced)replay();else onRunning(false);
  return { replay, setReduced(value){reduced=value;if(value){stop();active=false;onRunning(false);render();}}, dispose(){disposed=true;stop();resize.disconnect();observer.disconnect();document.removeEventListener("visibilitychange",visibility);renderer.domElement.removeEventListener("webglcontextlost",contextLost);renderer.domElement.removeEventListener("webglcontextrestored",contextRestored);resources.forEach(r=>r.dispose());renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();host.classList.remove("webgl-ready");} };
}
