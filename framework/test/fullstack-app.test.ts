import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fullstackFiles } from "../src/fullstack-template";
import { create } from "../src/create";

test("fullstack template stays in sync and scaffolds persistent state outside public assets",()=>{
  const root=join(import.meta.dir,"../../apps/fullstack");
  for(const [file,text] of Object.entries(fullstackFiles)) expect(readFileSync(join(root,file),"utf8").replaceAll("3007","3001")).toBe(text);
  const temp=mkdtempSync(join(tmpdir(),"optz-template-"));
  try{create(temp,"fullstack");expect(readFileSync(join(temp,".gitignore"),"utf8")).toContain(".data/");expect(readdirSync(join(temp,"app/api/auth"))).toContain("[operation].ts");}finally{rmSync(temp,{recursive:true,force:true});}
});
test("full app enforces cross-user ownership, persists sessions, rejects CSRF and serves private uploads",async()=>{
  const root=join(import.meta.dir,"../../apps/fullstack"), temp=mkdtempSync(join(tmpdir(),"optz-e2e-"));
  const cli=join(import.meta.dir,"../src/cli.ts"), port=37000+(process.pid%10000), origin=`http://localhost:${port}`;
  const env={...process.env,PORT:String(port),PUBLIC_URL:origin,DATABASE_PATH:join(temp,"app.sqlite"),UPLOAD_DIR:join(temp,"uploads")};
  let server:ReturnType<typeof Bun.spawn>|undefined;
  const build=Bun.spawnSync([process.execPath,cli,"build"],{cwd:root,env,stdout:"pipe",stderr:"pipe"});
  expect(build.exitCode).toBe(0);
  const start=async()=>{
    server=Bun.spawn([process.execPath,cli,"start"],{cwd:root,env,stdout:"ignore",stderr:"pipe"});
    for(let i=0;i<100;i++) {try{if((await fetch(origin)).ok)return;}catch{}await Bun.sleep(25);}
    throw new Error("Starter failed to start: "+await new Response(server.stderr as ReadableStream<Uint8Array>).text());
  };
  const stop=async()=>{if(server){server.kill();await server.exited;server=undefined;}};
  const post=(path:string,body:Record<string,string>,cookie?:string,source=origin)=>fetch(origin+path,{method:"POST",body:new URLSearchParams(body),headers:{Origin:source,...(cookie?{Cookie:cookie}:{})},redirect:"manual"});
  try{
    await start();
    expect((await fetch(origin+"/dashboard",{redirect:"manual"})).status).toBe(303);
    const register=async(email:string)=>{const r=await post("/api/auth/register",{email,password:"a long enough secret password"});expect(r.status).toBe(303);return r.headers.get("set-cookie")!.split(";")[0];};
    const alice=await register("alice@example.test"), bob=await register("bob@example.test");
    expect((await post("/api/notes",{text:"Alice's private note"},alice)).status).toBe(303);
    let dashboard=await fetch(origin+"/dashboard",{headers:{Cookie:alice}});expect(dashboard.headers.get("cache-control")).toContain("no-store");
    let html=await dashboard.text();expect(html).toContain("Alice&#x27;s private note");
    const id=html.match(/\/api\/notes\/([a-f0-9-]+)/)![1];
    expect((await post("/api/notes/"+id,{operation:"delete"},bob)).status).toBe(404);
    expect((await post("/api/notes",{text:"forged"},alice,"https://evil.example")).status).toBe(403);
    expect(await (await fetch(origin+"/dashboard",{headers:{Cookie:bob}})).text()).not.toContain("private note");
    const unsupported=new FormData();unsupported.set("file",new File(["<script>x</script>"],"x.html",{type:"text/html"}));
    expect((await fetch(origin+"/api/files",{method:"POST",body:unsupported,headers:{Origin:origin,Cookie:alice},redirect:"manual"})).status).toBe(415);
    const form=new FormData();form.set("file",new File(["secret attachment"],"note.txt",{type:"text/plain"}));
    const upload=await fetch(origin+"/api/files",{method:"POST",body:form,headers:{Origin:origin,Cookie:alice},redirect:"manual"});expect(upload.status).toBe(303);
    html=await (await fetch(origin+"/dashboard",{headers:{Cookie:alice}})).text();
    const key=html.match(/\/api\/files\/([a-f0-9-]+)/)![1];
    expect((await fetch(origin+"/api/files/"+key,{headers:{Cookie:bob}})).status).toBe(404);
    const file=await fetch(origin+"/api/files/"+key,{headers:{Cookie:alice}});expect(file.headers.get("content-disposition")).toContain("attachment;");expect(await file.text()).toBe("secret attachment");
    await stop();await start();
    expect(await (await fetch(origin+"/dashboard",{headers:{Cookie:alice}})).text()).toContain("private note");
    expect((await post("/api/auth/logout",{},alice)).status).toBe(303);
    expect((await fetch(origin+"/dashboard",{headers:{Cookie:alice},redirect:"manual"})).status).toBe(303);
  } finally{await stop();rmSync(temp,{recursive:true,force:true});}
},30000);
