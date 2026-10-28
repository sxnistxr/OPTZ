import { expect, test } from "bun:test";
import { ResponseCache } from "../src/cache";
import { createApp, middlewareFrom } from "../src/handler";
import { compilePattern } from "../src/match";
import type { Manifest } from "../src/manifest";
import { resolveConfig, type Config, type Middleware } from "../src/types";
import { cache, cookies, draftMode, env, revalidateTag } from "../src/server-api";
import type { StaticEntry } from "../src/static";

const manifest = (kind: "api" | "page" = "api"): Manifest => ({ version:3, builtAt:Date.now(), mode:"islands",entry:"/entry.js",css:[],
  routes:[{pattern:"/admin/secret",segments:compilePattern("/admin/secret"),file:"secret.ts",kind,render:"dynamic",hasLoader:kind==="page",layouts:[],preload:[]}],
  islands:{},rootLayouts:[],redirects:{},slots:[],intercepts:[],actions:{},fonts:[],apiStatic:{} });
const request = (path: string, init?: RequestInit) => new Request("https://site.test"+path, init);

test("cache bypasses credentials and never gives a waiter another caller's private cookie", async () => {
  const c = new ResponseCache(10,1<<20);
  for (const header of ["cookie","authorization"]) {
    const responses = await Promise.all(["alice","bob"].map(user => c.handle(request("/",{headers:{[header]:user}}),"k",{maxAge:60},async()=>{
      await Bun.sleep(5);
      return new Response(user,{headers:{"Set-Cookie":`session=${user}`}});
    })));
    expect(await Promise.all(responses.map(r=>r.text()))).toEqual(["alice","bob"]);
    expect(responses[1].headers.get("set-cookie")).toBe("session=bob");
    expect(responses[1].headers.get("cache-control")).toBe("private, no-store");
  }
  const rs = await Promise.all(["one","two"].map(user => c.handle(request("/"),"k",{maxAge:60},async()=>{
    await Bun.sleep(5); return new Response(user,{headers:{"Cache-Control":"PRIVATE, no-store","Set-Cookie":`session=${user}`}});
  })));
  expect(await Promise.all(rs.map(r=>r.text()))).toEqual(["one","two"]);
  expect(rs[1].headers.get("set-cookie")).toBe("session=two");
});

test("concurrent cold Vary responses and raw header reads stay partitioned", async () => {
  const c = new ResponseCache(10,1<<20);
  for (const vary of [true,false]) {
    const get = (lang:string) => c.handle(request("/",{headers:{"accept-language":lang}}),String(vary),{maxAge:60}, async()=>{
      await Bun.sleep(5);return new Response(lang,{headers:vary?{Vary:"accept-language"}:{}});
    });
    const rs = await Promise.all([get("en"),get("fr")]);
    expect(await Promise.all(rs.map(r=>r.text()))).toEqual(["en","fr"]);
    expect(await (await get("fr")).text()).toBe("fr");
  }
});

const denied = middlewareFrom({matcher:["/admin/[...rest]"],default:()=>new Response("denied",{status:403})});
const make = (config:Config={}, middleware:Middleware[]=denied, files=new Map<string,StaticEntry>(), kind:"api"|"page"="api") => createApp({
  manifest:manifest(kind),config:resolveConfig(config),middleware,files,
  platform:{load:async()=>({GET:()=>new Response("secret"),loader:()=>({secret:"loader-secret"}),default:()=>null})},
});
test("static/dynamic loader JSON, locale variants, and OG images inherit page authorization",async()=>{
  const entry:StaticEntry={body:new TextEncoder().encode('{"secret":"static"}'),type:"application/json",etag:'"x"',cache:"no-cache"};
  for(const staticData of [true,false]){
    const app=await make({i18n:{locales:["en","fr"],defaultLocale:"en"}},denied,staticData?new Map([["/_optz/data/admin/secret.json",entry]]):new Map(),"page");
    for(const path of ["/admin/secret","/_optz/data/admin/secret.json","/_optz/data/fr/admin/secret.json","/fr/admin/secret","/_optz/og/admin/secret.png"]){
      expect((await app.fetch(request(path))).status).toBe(403);
    }
  }
  const open = await make({},[],new Map(),"page");
  expect(await (await open.fetch(request("/_optz/data/admin/secret.json"))).json()).toMatchObject({data:{secret:"loader-secret"}});
});
test("rewrites authorize every protected identity and dispatch the mutation once",async()=>{
  let calls=0;
  const app=await make({rewrites:[{source:"/alias",destination:"/middle"},{source:"/middle",destination:"/admin/secret"}]},[...denied,async(_ctx,next)=>{calls++;return next();}]);
  expect((await app.fetch(request("/alias"))).status).toBe(403);
  expect(calls).toBe(0);
  const sourcePolicy=middlewareFrom({matcher:["/alias"],default:()=>new Response("source denied",{status:401})});
  expect((await (await make({rewrites:[{source:"/alias",destination:"/admin/secret"}]},sourcePolicy)).fetch(request("/alias"))).status).toBe(401);
});
test("unscoped path policies see the logical destination",async()=>{
  const app=await make({rewrites:[{source:"/alias",destination:"/admin/secret"}]},[(ctx,next)=>ctx.url.pathname.startsWith("/admin/")?new Response(null,{status:403}):next()]);
  expect((await app.fetch(request("/alias"))).status).toBe(403);
  expect((await app.fetch(request("/_optz/data/admin/secret.json"))).status).toBe(403);
});
test("app-local revalidation and draft signing survive creating a second app",async()=>{
  const events:string[]=[];
  const create = (id:string) => createApp({manifest:manifest(), config:resolveConfig({draft:{secret:id.repeat(32)},revalidation:{purge:()=>{events.push(id);}}}),files:new Map(),
    platform:{load:async()=>({GET:({url}:{url:URL})=>{if(url.searchParams.has("state")) return Response.json({draft:draftMode().isEnabled});revalidateTag("x");draftMode().enable();return new Response("ok");}})}});
  const a=await create("a");const b=await create("b");
  const res=await a.fetch(request("/admin/secret"));
  expect(events).toEqual(["a"]);
  const cookie=res.headers.get("set-cookie")!.split(";")[0];
  expect(await (await a.fetch(request("/admin/secret?state",{headers:{cookie}}))).json()).toEqual({draft:true});
  expect(await (await b.fetch(request("/admin/secret?state",{headers:{cookie}}))).json()).toEqual({draft:false});
  // Each app accepts only the cookie signed by its own factory.
  // Verify no accidental last-created callback by issuing alternating mutations too.
  await b.fetch(request("/admin/secret"));await a.fetch(request("/admin/secret",{headers:{cookie}}));
  expect(events).toEqual(["a","b","a"]);
});
test("raw API header reads disable CDN caching unless explicitly declared as Vary",async()=>{
  const app=await createApp({manifest:manifest(),config:resolveConfig({}),files:new Map(),platform:{load:async()=>({cache:{maxAge:60},GET:({request}:{request:Request})=>new Response(request.headers.get("x-user")??"anonymous")})}});
  for(const user of ["alice","bob"]){
    const r=await app.fetch(request("/admin/secret",{headers:{"x-user":user}}));
    expect(await r.text()).toBe(user);expect(r.headers.get("cache-control")).toBe("private, no-store");
  }
});

test("shared cache functions keep app environments and invalidation separate",async()=>{
  const value=cache(()=>env<{id:string}>().id,{tags:["x"]});
  const create=()=>createApp({manifest:manifest(),config:resolveConfig({}),files:new Map(),platform:{load:async()=>({GET:async()=>new Response(await value())})}});
  const a=await create(), b=await create();
  expect(await (await a.fetch(request("/admin/secret"),{env:{id:"a"}})).text()).toBe("a");
  expect(await (await b.fetch(request("/admin/secret"),{env:{id:"b"}})).text()).toBe("b");
});
test("new sessions are never cached even when Cookie is a configured vary field",async()=>{
  let calls=0;
  const app=await createApp({manifest:manifest(),config:resolveConfig({}),files:new Map(),platform:{load:async()=>({cache:{maxAge:60,vary:["cookie"]},GET:()=>{
    const secret=String(++calls);cookies().set("session",secret);return new Response(secret);
  }})}});
  const first=await app.fetch(request("/admin/secret"));const second=await app.fetch(request("/admin/secret"));
  expect(await first.text()).toBe("1");expect(await second.text()).toBe("2");
  expect(second.headers.get("cache-control")).toBe("private, no-store");
});

test("middleware Request URL and context URL refer to the same protected route",async()=>{
  const app=await make({rewrites:[{source:"/alias",destination:"/admin/secret"}]},[(ctx,next)=>new URL(ctx.request.clone().url).pathname.startsWith("/admin/")?new Response(null,{status:403}):next()]);
  expect((await app.fetch(request("/alias"))).status).toBe(403);
  expect((await app.fetch(request("/_optz/data/admin/secret.json"))).status).toBe(403);
});
test("MCP rejects oversized bodies and batch fan-out before running tools",async()=>{
  const {createMcpServer,defineTool}=await import("../src/mcp");
  let calls=0;
  const server=createMcpServer({config:resolveConfig({server:{maxRequestBodySize:16384}}),modules:[{file:"app/mcp/count.ts",mod:{default:defineTool({description:"count",run:()=>{calls++;return "ok";}})}}]});
  const msg={jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"count",arguments:{}}};
  const post=async(body:string)=>{
    const req=request("/mcp",{method:"POST",headers:{"content-type":"application/json"},body});
    return server.handle({request:req,url:new URL(req.url),locals:{}});
  };
  expect((await post(JSON.stringify(Array.from({length:33},()=>msg)))).status).toBe(413);
  expect((await post('"'+"x".repeat(20000)+'"')).status).toBe(413);
  expect(calls).toBe(0);
  expect((await post(JSON.stringify(msg))).status).toBe(200);expect(calls).toBe(1);
});
