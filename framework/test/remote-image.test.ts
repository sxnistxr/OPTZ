import { expect, test } from "bun:test";
import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { fetchRemoteImage, isPublicAddress, readImageBody } from "../src/remote-image";
import { readBody } from "../src/body";
import { handleImage } from "../src/image";
import { resolveConfig } from "../src/types";
import type { StaticEntry } from "../src/static";
import { nginxConfig } from "../src/nginx";

const reply=(status:number,headers:Record<string,string>,chunks:Uint8Array[]=[])=>Object.assign(Readable.from(chunks),{statusCode:status,headers}) as unknown as IncomingMessage;
test("remote image redirects cannot change to unapproved hosts, schemes, ports or private IPs",async()=>{
  for(const location of ["http://images.example/x","https://other.example/x","https://images.example:444/x","https://127.0.0.1/x","https://[::1]/x","https://user:pass@images.example/x"]){
    let calls=0;
    await expect(fetchRemoteImage(new URL("https://images.example/a"),["images.example","127.0.0.1","[::1]"],async()=>{calls++;return reply(302,{location});})).rejects.toThrow("not allowed");
    expect(calls).toBe(1);
  }
  let calls=0;
  const image=await fetchRemoteImage(new URL("https://images.example/a"),["images.example"],async()=>++calls===1?reply(302,{location:"/b"}):reply(200,{"content-type":"image/png"},[new Uint8Array([1,2])]));
  expect(image.body).toEqual(new Uint8Array([1,2]));expect(calls).toBe(2);
  calls=0;
  await expect(fetchRemoteImage(new URL("https://images.example/a"),["images.example"],async()=>{calls++;return reply(302,{location:"/loop"});})).rejects.toThrow("too many");
  expect(calls).toBe(4);
});
test("image address policy rejects special networks, including mapped IPv6",()=>{
  for(const address of ["0.0.0.0","10.1.2.3","127.0.0.1","100.64.0.1","169.254.169.254","172.16.0.1","192.168.0.1","192.0.2.1","198.18.0.1","224.0.0.1","255.255.255.255","::1","::ffff:127.0.0.1","::ffff:7f00:1","fc00::1","fe80::1","64:ff9b::a00:1","2001:db8::1","2002:7f00:1::1","not-an-ip"]){expect(isPublicAddress(address)).toBe(false);}
  for(const address of ["8.8.8.8","1.1.1.1","2606:4700::1111","2001:4860:4860::8888"]){expect(isPublicAddress(address)).toBe(true);}
});
test("streaming body caps stop and cancel instead of buffering the remaining response",async()=>{
  let pulls=0,closed=false;
  async function* chunks(){try{for(let i=0;i<100;i++){pulls++;yield new Uint8Array(4);}}finally{closed=true;}}
  await expect(readImageBody(chunks(),5)).rejects.toThrow("too large");
  expect(pulls).toBe(2);expect(closed).toBe(true);
  let cancelled=false;
  const stream=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new Uint8Array(4));},cancel(){cancelled=true;}});
  await expect(readBody(stream,5)).rejects.toThrow("too large");expect(cancelled).toBe(true);
  await expect(readBody(new ReadableStream(),5,5)).rejects.toThrow("timed out");
});
test("image admission queue rejects overload before buffers/encoders are allocated",async()=>{
  const files=new Map<string,StaticEntry>([["/a.gif",{body:new Uint8Array([1]),type:"image/gif",etag:"x",cache:""}]]);
  const config=resolveConfig({images:{concurrency:1}});
  const get=()=>handleImage(new Request("https://site/_optz/image"),new URL("https://site/_optz/image?url=/a.gif&w=100"),{root:"/tmp",files,config});
  const rs=await Promise.all(Array.from({length:20},get));
  expect(rs.filter(r=>r.status===200).length).toBe(9);
  expect(rs.filter(r=>r.status===503).length).toBe(11);
});
test("generated HTTPS upstreams verify hostname and trust; HTTP targets omit TLS directives",()=>{
  const config=resolveConfig({proxy:{"/ext":{target:"https://api.example/v1",bypassMiddleware:true},"/local":{target:"http://127.0.0.1:9000",bypassMiddleware:true}}});
  const out=nginxConfig(config,{distDir:"/srv/dist",upstreamCaFile:"/etc/ssl/custom.pem"});
  expect(out).toContain("proxy_ssl_verify on;");expect(out).toContain("proxy_ssl_name api.example;");expect(out).toContain('proxy_ssl_trusted_certificate "/etc/ssl/custom.pem";');
  expect(out.match(/proxy_ssl_verify on;/g)?.length).toBe(1);
});
test("the real HTTPS transport refuses DNS names resolving to loopback before connecting",async()=>{
  await expect(fetchRemoteImage(new URL("https://localhost/image.png"),["localhost"])).rejects.toThrow("not public");
});
test("remote content length and content type are checked before consuming bytes",async()=>{
  for(const headers of [{"content-type":"text/html"},{"content-type":"image/png","content-length":String((20<<20)+1)}]){
    let read=false;
    const body=Readable.from((async function*(){read=true;yield new Uint8Array([1]);})());
    const response=Object.assign(body,{statusCode:200,headers}) as unknown as IncomingMessage;
    await expect(fetchRemoteImage(new URL("https://images.example/a"),["images.example"],async()=>response)).rejects.toThrow();
    expect(read).toBe(false);expect(response.destroyed).toBe(true);
  }
});
