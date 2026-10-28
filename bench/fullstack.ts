// Reproducible in-process dispatch and route-index benchmark, not a network/CDN comparison.
import { cpus, platform, release } from "node:os";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createApp } from "../framework/src/handler";
import { createRouteMatcher } from "../framework/src/route-index";
import { compilePattern, matchRoute } from "../framework/src/match";
import { resolveConfig } from "../framework/src/types";
import type { Manifest, ManifestRoute } from "../framework/src/manifest";
const flag = (name: string) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
const baseline = resolve(flag("--baseline") ?? "/workspace/scratch/optz-perf-baseline");
const old = await import(join(baseline, "framework/src/handler.ts"));
const median = (a: number[]) => [...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
const run = (f: () => unknown, n: number) => { let sink:unknown;const start=performance.now();for(let i=0;i<n;i++)sink=f();if(!sink)throw new Error("Bad benchmark fixture");return (performance.now()-start)*1e6/n; };
const runAsync = async (f: () => Promise<Response>, n: number) => { const start=performance.now();for(let i=0;i<n;i++){const res=await f();if(res.status!==200)throw new Error("Bad response");await res.body?.cancel();}return (performance.now()-start)*1e6/n; };
const matching: unknown[]=[], serving: unknown[]=[];
for(const size of [10,100,1000]){
  const routes=Array.from({length:size},(_,i)=>({pattern:`/section${i}/page`,segments:compilePattern(`/section${i}/page`)}));
  const path=routes.at(-1)!.pattern, indexed=createRouteMatcher(routes);
  for(let i=0;i<2000;i++){matchRoute(routes,path);indexed(path);}
  const linear:number[]=[],fast:number[]=[];
  for(let i=0;i<5;i++){linear.push(run(()=>matchRoute(routes,path),5000));fast.push(run(()=>indexed(path),5000));}
  matching.push({routes:size,path,linear_ns:median(linear),indexed_ns:median(fast),ratio:median(linear)/median(fast),samples:{linear,fast}});
  const manifest:Manifest={version:3,builtAt:Date.now(),mode:"islands",entry:"/entry.js",css:[],routes:routes.map(r=>({...r,file:r.pattern+".tsx",kind:"page",render:"static",hasLoader:false,layouts:[],preload:[]})) as ManifestRoute[],islands:{},rootLayouts:[],redirects:{},slots:[],intercepts:[],actions:{},fonts:[],apiStatic:{}};
  const files=()=>new Map(routes.map(r=>[r.pattern+"/index.html",{body:new TextEncoder().encode("<h1>hello</h1>"),type:"text/html",etag:'"x"',cache:"no-cache"}]));
  for(const middlewareCount of [0,1]) {
  const middleware = middlewareCount ? [async (_ctx: unknown, next: () => Promise<Response>) => { const res=await next(); res.headers.set("X-Content-Type-Options","nosniff"); return res; }] : [];
  const opts=()=>({manifest,middleware,config:resolveConfig({features:{dynamic:false}}),files:files(),platform:{load:async()=>({})}});
  const a=await old.createApp(opts()),b=await createApp(opts());
  const req=new Request("http://benchmark.test"+path);
  for(let i=0;i<1000;i++){await a.fetch(req);await b.fetch(req);}
  const before:number[]=[],after:number[]=[];
  for(let i=0;i<5;i++){before.push(await runAsync(()=>a.fetch(req),1000));after.push(await runAsync(()=>b.fetch(req),1000));}
  serving.push({routes:size,middleware:middlewareCount,path,before_ns:median(before),after_ns:median(after),ratio:median(before)/median(after),samples:{before,after}});
  }
}
const root=resolve(import.meta.dir,"..");
const source=createHash("sha256");for(const f of readdirSync(join(root,"framework/src")).sort())if(/\.[tj]sx?$/.test(f)){source.update(f);source.update(readFileSync(join(root,"framework/src",f)));}
const git=(dir:string,...args:string[])=>Bun.spawnSync(["git","-C",dir,...args]).stdout.toString().trim();
const result={date:new Date().toISOString(),bun:Bun.version,cpu:cpus()[0].model,platform:platform(),kernel:release(),baseline_commit:git(baseline,"rev-parse","HEAD"),working_commit:git(root,"rev-parse","HEAD"),dirty:!!git(root,"status","--porcelain"),framework_source_sha256:source.digest("hex"),method:"5 interleaved samples, medians, warmed in-process, zero/one header middleware, static page at end of manifest. ns/op; not network throughput, application rendering or production tail latency.",matching,serving};
writeFileSync(flag("--out")??join(root,"bench/fullstack-results.json"),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify({matching,serving},null,2));
