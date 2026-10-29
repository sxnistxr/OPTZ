import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, readdirSync } from "node:fs";
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

test("development ignores SQLite and upload state while source changes still restart the child",async()=>{
  const tempRoot=join(import.meta.dir,"../.tmp");mkdirSync(tempRoot,{recursive:true});
  const root=mkdtempSync(join(tempRoot,"fullstack-dev-"));
  const cli=join(import.meta.dir,"../src/cli.ts"), port=50000+(process.pid%5000), origin=`http://localhost:${port}`;
  const env={...process.env,PORT:String(port),PUBLIC_URL:origin,
    DATABASE_PATH:join(root,".data/app.sqlite"),UPLOAD_DIR:join(root,".data/uploads")};
  let server:ReturnType<typeof Bun.spawn>|undefined, output="";
  const pid=async()=>{
    try{const response=await fetch(origin+"/api/pid",{signal:AbortSignal.timeout(1000)});if(response.ok)return await response.json() as number;}catch{}
  };
  try{
    create(root,"fullstack");
    const source=join(root,"app/api/pid.ts");
    await Bun.write(source,'export const GET=()=>Response.json(process.pid);');
    server=Bun.spawn([process.execPath,cli,"dev"],{cwd:root,env,stdout:"pipe",stderr:"pipe"});
    const collect=async(stream:ReadableStream<Uint8Array>)=>{for await(const chunk of stream)output+=new TextDecoder().decode(chunk);};
    const logs=Promise.all([collect(server.stdout as ReadableStream<Uint8Array>),collect(server.stderr as ReadableStream<Uint8Array>)]);
    let original:number|undefined;
    for(let i=0;i<200 && !original;i++){original=await pid();if(!original)await Bun.sleep(25);}
    if(!original)throw new Error("Development server did not start: "+output);
    const post=(path:string,body:Record<string,string>,cookie?:string)=>fetch(origin+path,{method:"POST",body:new URLSearchParams(body),headers:{Origin:origin,...(cookie?{Cookie:cookie}:{})},redirect:"manual"});
    const registration=await post("/api/auth/register",{email:"dev@example.test",password:"development test password"});
    expect(registration.status).toBe(303);
    const cookie=registration.headers.get("set-cookie")!.split(";")[0];
    expect((await post("/api/notes",{text:"Write the SQLite database"},cookie)).status).toBe(303);
    mkdirSync(join(root,".data/uploads"),{recursive:true});
    await Bun.write(join(root,".data/uploads/attachment.txt"),"private state");
    await Bun.sleep(300);
    expect(output).not.toContain("changed, restarting");
    expect(await pid()).toBe(original);
    await Bun.write(source,'export const GET=()=>Response.json(process.pid); // source edit');
    let restarted:number|undefined;
    for(let i=0;i<200;i++){const current=await pid();if(current && current!==original){restarted=current;break;}await Bun.sleep(25);}
    expect(restarted).toBeDefined();
    server.kill("SIGINT");await server.exited;await logs;server=undefined;
  }finally{
    if(server){server.kill("SIGINT");await server.exited;}
    rmSync(root,{recursive:true,force:true});
  }
},20000);
