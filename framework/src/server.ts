// `optz start` (and the dev server): one Bun.serve handling pages, data, API routes, static
// files, middleware and proxying.
//
// Speed comes from doing almost nothing per request for the common cases: pre-rendered pages,
// their data and every asset are loaded into memory at startup along with brotli and gzip
// copies and an ETag, so serving them is a map lookup. React only runs for dynamic pages.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "bun";
import { outDirFor, type Manifest, type ManifestRoute } from "./build";
import { dataPath, matchRoute } from "./match";
import { loadData, renderPage, type RenderInput } from "./render";
import type { ApiHandler, Config, ErrorModule, LayoutModule, Middleware, MiddlewareContext, PageModule } from "./types";

interface StaticEntry {
  body: Uint8Array;
  br?: Uint8Array;
  gz?: Uint8Array;
  type: string;
  etag: string;
  cache: string;
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml",
  woff2: "font/woff2",
  woff: "font/woff",
  pdf: "application/pdf",
  map: "application/json",
  webmanifest: "application/manifest+json",
};

function loadStatic(dir: string): Map<string, StaticEntry> {
  const map = new Map<string, StaticEntry>();
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) {
        walk(f);
        continue;
      }
      if (f.endsWith(".gz") || f.endsWith(".br")) continue;
      const url = "/" + relative(dir, f).split("\\").join("/");
      const ext = f.slice(f.lastIndexOf(".") + 1).toLowerCase();
      const body = readFileSync(f);
      map.set(url, {
        body,
        br: existsSync(`${f}.br`) ? readFileSync(`${f}.br`) : undefined,
        gz: existsSync(`${f}.gz`) ? readFileSync(`${f}.gz`) : undefined,
        type: TYPES[ext] ?? "application/octet-stream",
        etag: `"${Bun.hash(body).toString(36)}"`,
        cache: url.startsWith("/assets/") ? "public, max-age=31536000, immutable" : ext === "html" || ext === "json" ? "no-cache" : "public, max-age=3600",
      });
    }
  };
  if (existsSync(dir)) walk(dir);
  return map;
}

function send(e: StaticEntry, req: Request, status = 200): Response {
  const h: Record<string, string> = { "Content-Type": e.type, "Cache-Control": e.cache, ETag: e.etag, Vary: "Accept-Encoding" };
  if (status === 200 && req.headers.get("if-none-match") === e.etag) return new Response(null, { status: 304, headers: h });
  const ae = req.headers.get("accept-encoding") ?? "";
  let body = e.body;
  if (e.br && ae.includes("br")) {
    body = e.br;
    h["Content-Encoding"] = "br";
  } else if (e.gz && ae.includes("gzip")) {
    body = e.gz;
    h["Content-Encoding"] = "gzip";
  }
  return new Response(body, { status, headers: h });
}

function html(body: string, req: Request, status = 200): Response {
  const h: Record<string, string> = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", Vary: "Accept-Encoding" };
  if (body.length > 1024 && (req.headers.get("accept-encoding") ?? "").includes("gzip")) {
    h["Content-Encoding"] = "gzip";
    return new Response(gzipSync(body, { level: 6 }), { status, headers: h });
  }
  return new Response(body, { status, headers: h });
}

const jsonRes = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } });

export interface ServeOptions {
  root: string;
  config: Config;
  dev?: boolean;
  port?: number;
  hostname?: string;
}

export async function serve({ root, config, dev, port, hostname }: ServeOptions) {
  const out = outDirFor(root, dev);
  const manifest: Manifest = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
  const files = loadStatic(join(out, "static"));
  const modules = new Map<string, Promise<unknown>>();
  const load = <T,>(f: string) => {
    let m = modules.get(f);
    if (!m) modules.set(f, (m = import(join(root, f))));
    return m as Promise<T>;
  };

  let middleware: Middleware[] = [];
  for (const f of ["app/middleware.ts", "app/middleware.tsx", "app/middleware.js"]) {
    if (!existsSync(join(root, f))) continue;
    const m = (await import(join(root, f))) as { default?: Middleware | Middleware[] };
    middleware = m.default ? (Array.isArray(m.default) ? m.default : [m.default]) : [];
  }

  const proxies = Object.entries(config.proxy ?? {}).sort((a, b) => b[0].length - a[0].length);
  const sse = new Set<ReadableStreamDefaultController<string>>();

  const renderInput = async (r: ManifestRoute, ctx: MiddlewareContext, pathname: string, params: Record<string, string>): Promise<RenderInput> => ({
    page: await load<PageModule>(r.file),
    layouts: await Promise.all(r.layouts.map((l) => load<LayoutModule>(l))),
    error: r.error ? await load<ErrorModule>(r.error) : undefined,
    pattern: r.pattern,
    pathname,
    params,
    ctx: { url: ctx.url, request: ctx.request, locals: ctx.locals },
  });

  async function notFound(ctx: MiddlewareContext): Promise<Response> {
    const f = files.get("/404.html");
    if (f) return send(f, ctx.request, 404);
    if (manifest.notFound) {
      const page = await load<PageModule>(manifest.notFound);
      const layouts = await Promise.all(manifest.rootLayouts.map((l) => load<LayoutModule>(l)));
      const r = await renderPage({ page, layouts, pattern: "/_404", pathname: ctx.url.pathname, params: {}, ctx: { url: ctx.url, locals: ctx.locals } }, { entry: manifest.entry, css: manifest.css, preload: [], dev }, config);
      if (r.kind === "page") return html(r.html, ctx.request, 404);
    }
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }

  async function data(ctx: MiddlewareContext): Promise<Response> {
    const p = ctx.url.pathname;
    if (!dev) {
      const f = files.get(p);
      if (f) return send(f, ctx.request);
    }
    const pathname = p.slice("/_optz/data".length, -".json".length);
    const target = pathname === "/index" ? "/" : pathname;
    const m = matchRoute(manifest.routes, target);
    if (!m || m.route.kind !== "page" || (!dev && m.route.render !== "dynamic")) return jsonRes({ error: "not found" }, 404);
    const r = await loadData(await renderInput(m.route, ctx, target, m.params));
    if (r.kind === "redirect") return jsonRes({ redirect: r.response.headers.get("Location") });
    if (r.kind === "notFound") return jsonRes({ error: "not found" }, 404);
    return jsonRes(r.payload);
  }

  async function route(ctx: MiddlewareContext): Promise<Response> {
    const { request: req, url } = ctx;
    const p = url.pathname;
    if (p.length > 1 && p.endsWith("/")) return new Response(null, { status: 308, headers: { Location: p.replace(/\/+$/, "") + url.search } });
    if (p.startsWith("/_optz/data/") && p.endsWith(".json")) return data(ctx);
    if (p.startsWith("/_optz/")) return notFound(ctx);
    const redir = manifest.redirects[p];
    if (redir) return new Response(null, { status: redir.status, headers: { Location: redir.location } });

    const m = matchRoute(manifest.routes, p);
    if (m) {
      const r = m.route;
      if (r.kind === "api") {
        const mod = await load<Record<string, ApiHandler>>(r.file);
        const handler = mod[req.method] ?? (req.method === "HEAD" ? mod.GET : undefined);
        if (!handler) {
          const allow = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].filter((k) => mod[k]).join(", ");
          return new Response(null, { status: 405, headers: { Allow: allow } });
        }
        return handler({ ...ctx, params: m.params });
      }
      if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
      if (!dev && r.render === "static") {
        const f = files.get(p === "/" ? "/index.html" : `${p}/index.html`);
        return f ? send(f, req) : notFound(ctx);
      }
      if (!dev && r.render === "client" && r.shell) {
        const f = files.get(r.shell);
        if (f) return send(f, req);
      }
      const input = await renderInput(r, ctx, p, m.params);
      if (r.render === "client") input.skipLoader = true;
      const out = await renderPage(input, { entry: manifest.entry, css: manifest.css, preload: r.preload, dev }, config);
      if (out.kind === "redirect") return out.response;
      if (out.kind === "notFound") return notFound(ctx);
      return html(out.html, req);
    }
    const f = files.get(p);
    if (f && !p.endsWith(".html")) return send(f, req);
    return notFound(ctx);
  }

  const run = (ctx: MiddlewareContext, i: number): Promise<Response> =>
    i < middleware.length ? Promise.resolve(middleware[i](ctx, () => run(ctx, i + 1))) : route(ctx);

  const server = Bun.serve({
    port: port ?? Number(process.env.PORT ?? config.port ?? 3001),
    hostname: hostname ?? process.env.HOST ?? config.hostname ?? "127.0.0.1",
    development: dev ?? false,
    async fetch(req) {
      const url = new URL(req.url);
      const p = url.pathname;
      // Hashed assets: no middleware, straight from memory.
      if (p.startsWith("/assets/")) {
        const f = files.get(p);
        return f ? send(f, req) : new Response("Not found", { status: 404 });
      }
      for (const [prefix, rule] of proxies) {
        if (p === prefix || p.startsWith(prefix + "/")) {
          const target = new URL(rule.target);
          const path = rule.strip ? p.slice(prefix.length) || "/" : p;
          const headers = new Headers(req.headers);
          headers.delete("host");
          try {
            return await fetch(target.origin + path + url.search, { method: req.method, headers, body: req.body, redirect: "manual" });
          } catch {
            return jsonRes({ error: `upstream ${target.origin} is not reachable` }, 502);
          }
        }
      }
      if (dev && p === "/_optz/dev/events") {
        let ctl: ReadableStreamDefaultController<string>;
        return new Response(
          new ReadableStream<string>({
            start(c) {
              ctl = c;
              sse.add(c);
              c.enqueue(": connected\n\n");
            },
            cancel() {
              sse.delete(ctl);
            },
          }),
          { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } },
        );
      }
      const ctx: MiddlewareContext = { request: req, url, locals: {} };
      try {
        return await run(ctx, 0);
      } catch (e) {
        console.error(`optz: ${req.method} ${p}:`, e);
        const msg = dev ? `<pre>${Bun.escapeHTML(String((e as Error)?.stack ?? e))}</pre>` : "<h1>Internal server error</h1>";
        return new Response(`<!doctype html><meta charset="utf-8"><title>Error</title>${msg}`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    },
  });
  if (dev) setInterval(() => sse.forEach((c) => c.enqueue(": ping\n\n")), 15000);
  console.log(`optz: ${dev ? "dev server" : "serving"} on http://${server.hostname}:${server.port} (${files.size} files in memory, ${manifest.routes.length} routes, ${middleware.length} middleware)`);
  return server;
}
