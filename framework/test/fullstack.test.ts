import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessions, memorySessionStore } from "../src/sessions";
import { openDatabase, migrate, sqliteSessionStore } from "../src/sqlite";
import { parseInput, validateInput, ValidationError, formValues } from "../src/forms";
import { assertSameOrigin, createRateLimiter, cors } from "../src/security";
import { localStorage } from "../src/storage";
import { eventStream } from "../src/stream";
import { observe } from "../src/observe";
import { createRouteMatcher } from "../src/route-index";
import { compilePattern, matchRoute } from "../src/match";
import { serverBoundaries } from "../src/boundaries";

const request = (cookie?: string) => new Request("https://example.test/", { headers: cookie ? { cookie: cookie.split(";")[0] } : {} });
test("opaque SQLite sessions persist, store only token hashes, rotate, expire and revoke", async () => {
  const root = mkdtempSync(join(tmpdir(), "optz-session-"));
  const path = join(root, "app.db");
  let db = openDatabase(path), time = Date.now();
  const manager = () => createSessions<{ user: string }>({ store: sqliteSessionStore(db), now: () => time, maxAge: 10 });
  try {
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const a = manager(), cookie = await a.create({ user: "alice" });
    expect(cookie).toContain("__Host-optz_session="); expect(cookie).toContain("Secure"); expect(cookie).toContain("HttpOnly");
    const raw = cookie.split(";")[0].split("=")[1];
    const stored = db.query<{ id: string }, []>("SELECT id FROM __optz_sessions").get()!.id;
    expect(stored).not.toBe(raw);expect(raw.length).toBe(64);
    db.close();db = openDatabase(path);
    expect((await manager().read(request(cookie)))?.data.user).toBe("alice");
    const rotated = await manager().create({ user: "alice" }, request(cookie));
    expect(await manager().read(request(cookie))).toBeUndefined();
    expect((await manager().read(request(rotated)))?.data.user).toBe("alice");
    const cleared = await manager().destroy(request(rotated));expect(cleared).toContain("Max-Age=0");
    expect(await manager().read(request(rotated))).toBeUndefined();
    const expiring = await manager().create({ user: "bob" });time += 10001;
    expect(await manager().read(request(expiring))).toBeUndefined();
    expect(await manager().read(request("__Host-optz_session=forged"))).toBeUndefined();
  } finally { db.close();rmSync(root,{recursive:true,force:true}); }
});
test("memory sessions bound cardinality; cookie configuration fails before writes",async()=>{
  const store=memorySessionStore<{id:number}>(1);const sessions=createSessions({store});
  await sessions.create({id:1});await expect(sessions.create({id:2})).rejects.toThrow("capacity");
  expect(()=>createSessions({store,name:"__Host-session",secure:false})).toThrow();
  expect(()=>createSessions({store,name:"bad cookie"})).toThrow();
});
test("migrations are atomic, repeatable and checksum-protected",()=>{
  const db=openDatabase(":memory:");
  try{
    const v1={id:1,sql:"CREATE TABLE posts(id TEXT PRIMARY KEY)"};migrate(db,[v1]);migrate(db,[v1]);
    expect(()=>migrate(db,[{...v1,sql:"DROP TABLE posts"}])).toThrow("changed");
    expect(()=>migrate(db,[v1,{id:2,sql:"CREATE TABLE drafts(id TEXT)"},{id:3,sql:"invalid sql"}])).toThrow();
    expect(db.query("SELECT name FROM sqlite_master WHERE name='drafts'").get()).toBeNull();
    expect(db.query<{n:number},[]>("SELECT count(*) n FROM __optz_migrations").get()!.n).toBe(1);
  }finally{db.close();}
});
test("Standard Schema validation gives field errors without reflecting input values",async()=>{
  const schema={"~standard":{version:1 as const,vendor:"test",validate:async(input:unknown)=> typeof input==="string"?{value:input}:{issues:[{message:"Required",path:["email"]}]}}};
  expect(await validateInput(schema,"ok")).toBe("ok");
  await expect(validateInput(schema,{})).rejects.toBeInstanceOf(ValidationError);
  const req=new Request("http://x",{method:"POST",body:JSON.stringify({password:"SECRET"}),headers:{"Content-Type":"application/json"}});
  try{await parseInput(req,schema);throw new Error("expected error");}catch(error){expect(error).toBeInstanceOf(Response);const res=error as Response;expect(res.status).toBe(422);const text=await res.text();expect(text).toContain("email");expect(text).not.toContain("SECRET");}
  const form=new FormData();form.append("__proto__","safe");form.append("tags","a");form.append("tags","b");
  expect(Object.getPrototypeOf(formValues(form))).toBeNull();expect(formValues(form).tags).toEqual(["a","b"]);
  const oversized=new Request("http://x",{method:"POST",body:'"123456"',headers:{"Content-Type":"application/json"}});
  try{await parseInput(oversized,schema,{maxBytes:2});}catch(e){expect((e as Response).status).toBe(413);}
});
test("CSRF compares configured public origin; CORS allows only declared origins and headers",async()=>{
  expect(()=>assertSameOrigin(new Request("http://internal",{method:"POST",headers:{Origin:"https://evil.test"}}),"https://example.test")).toThrow();
  expect(()=>assertSameOrigin(new Request("http://internal",{method:"POST",headers:{Origin:"https://example.test"}}),"https://example.test")).not.toThrow();
  const mw=cors({origins:["https://example.test"],credentials:true});let called=false;
  const req=new Request("http://internal",{method:"OPTIONS",headers:{origin:"https://example.test","access-control-request-method":"POST","access-control-request-headers":"X-Admin"}});
  expect((await mw({request:req,url:new URL(req.url),locals:{}},async()=>{called=true;return new Response();})).status).toBe(403);expect(called).toBe(false);
});
test("limiter cannot evade active limits by flooding new keys",()=>{
  let now=0;const limiter=createRateLimiter({limit:2,windowMs:1000,maxKeys:2,now:()=>now});
  expect(limiter.consume("a").allowed).toBe(true);expect(limiter.consume("a").allowed).toBe(true);expect(limiter.consume("a").allowed).toBe(false);
  limiter.consume("b");expect(limiter.consume("c").allowed).toBe(false);expect(limiter.size).toBe(2);
  now=1001;expect(limiter.consume("c").allowed).toBe(true);expect(limiter.size).toBe(1);
});
test("private storage enforces size/type, randomized keys, modes and attachment-only reads",async()=>{
  const root=mkdtempSync(join(tmpdir(),"optz-files-")), storage=localStorage(root);
  try{
    const saved=await storage.save(new File(["hello"],"../../x.html",{type:"text/plain"}),{maxBytes:6,types:["text/plain"]});
    expect(saved.key).not.toContain("x.html");expect(statSync(join(root,saved.key)).mode&0o777).toBe(0o600);
    const res=await storage.response(saved.key,saved.name);expect(res.headers.get("content-type")).toBe("application/octet-stream");expect(res.headers.get("content-disposition")).toStartWith("attachment;");expect(await res.text()).toBe("hello");
    await expect(storage.save(new File(["TOO BIG"],"x"),{maxBytes:2})).rejects.toThrow();
    await expect(storage.response("../../etc/passwd")).rejects.toThrow();
    await storage.remove(saved.key);symlinkSync("/etc/passwd",join(root,saved.key));await expect(storage.response(saved.key)).rejects.toThrow();
  }finally{rmSync(root,{recursive:true,force:true});}
});
test("SSE is pull-based, abortable and rejects framing injection",async()=>{
  let sent=0,closed=0;
  const res=eventStream(request(),async function*(signal){try{while(!signal.aborted){sent++;yield{event:"update",data:{sent}};}}finally{closed++;}});
  const reader=res.body!.getReader();await reader.read();expect(sent).toBeLessThanOrEqual(2);await reader.cancel();await Bun.sleep(1);expect(closed).toBe(1);
  const bad=eventStream(request(),async function*(){yield{event:"x\ndata: injected",data:"bad"};});await expect(bad.text()).rejects.toThrow();
  let releases=0;const abort=new AbortController();abort.abort();
  const stopped=eventStream(new Request("http://x",{signal:abort.signal}),async function*(){yield{data:"x"};},{onClose:()=>{releases++;}});
  await expect(stopped.text()).rejects.toThrow();expect(releases).toBe(1);
});
test("observation excludes secrets/query and does not break immutable responses",async()=>{
  const events:unknown[]=[];const mw=observe({onRequest:e=>{events.push(e);}});
  const req=new Request("https://x/path?token=SECRET",{headers:{Authorization:"Bearer SECRET"}});
  const res=await mw({request:req,url:new URL(req.url),locals:{}},async()=>Response.redirect("https://x/next"));
  expect(res.status).toBe(302);expect(res.headers.get("server-timing")).toContain("app;dur=");expect(JSON.stringify(events)).not.toContain("SECRET");
});
test("indexed routes preserve linear precedence and decoding over varied manifests",()=>{
  const patterns=["/","/a","/a/[id]","/a/new","/[slug]","/docs/[[...rest]]","/docs/[...path]","/z/[id]/x","/a/[...all]"];
  const paths=["/","//a/","/a/new","/a/a%2Fb","/a/%zz","/docs","/docs/a/b","/none","/z/1/x","/missing/deep"];
  for(let shift=0;shift<patterns.length;shift++){
    const routes=[...patterns.slice(shift),...patterns.slice(0,shift)].map(pattern=>({pattern,segments:compilePattern(pattern)}));
    const fast=createRouteMatcher(routes);for(const path of paths)expect(fast(path)).toEqual(matchRoute(routes,path));
  }
});
test("browser build rejects direct and transitive server-only modules",async()=>{
  const root=mkdtempSync(join(tmpdir(),"optz-boundary-"));
  try{
    await Bun.write(join(root,"secret.server.ts"),'export const password="DO-NOT-SHIP"');
    await Bun.write(join(root,"shared.ts"),'export { password } from "./secret.server"');
    await Bun.write(join(root,"client.ts"),'import { password } from "./shared"; console.log(password)');
    const result = await Bun.build({entrypoints:[join(root,"client.ts")],target:"browser",plugins:[serverBoundaries()]}).catch(error => error);
    expect(result.success === false || result instanceof Error).toBe(true);
    expect((result.logs ?? result.errors ?? []).map((log: {message:string}) => log.message).join(" ")).toContain("Server-only");
  }finally{rmSync(root,{recursive:true,force:true});}
});

test("SPA builds strip legitimate server-only loader and head imports",async()=>{
  const { build }=await import("../src/build");
  const { resolveConfig }=await import("../src/types");
  const root=join(import.meta.dir,"../.tmp/server-boundary-"+process.pid);
  mkdirSync(join(root,"app/routes"),{recursive:true});mkdirSync(join(root,"app/lib"),{recursive:true});
  writeFileSync(join(root,"app/lib/data.server.ts"),'const secret="SERVER_ONLY_SENTINEL"; export function label(){ return secret.length > 0 ? "public" : "empty"; }');
  writeFileSync(join(root,"app/routes/index.tsx"),'import { label } from "../lib/data.server"; export const loader=()=>({ label:label() }); export const head=()=>({title:label()}); export default function Home(){return <h1>public</h1>;}');
  try{
    await build({root,config:resolveConfig({client:{mode:"spa"}})});
    const files=new Bun.Glob("**/*.js");for await(const file of files.scan(join(root,"dist/static/assets")))expect(await Bun.file(join(root,"dist/static/assets",file)).text()).not.toContain("SERVER_ONLY_SENTINEL");
  }finally{rmSync(root,{recursive:true,force:true});}
});
