// The request handler: pages, data, API routes, Server Actions, middleware, the response cache,
// incremental static regeneration, draft mode, i18n, parallel and intercepting routes.
// Web-standard code only (plus node:async_hooks): the Bun server, the compiled binary and the
// edge worker all run this same function.
//
// Speed comes from doing almost nothing per request for the common cases: pre-rendered pages,
// their data and every asset are in memory with brotli and gzip copies and an ETag, so serving
// them is a map lookup. React's server renderer isn't even loaded until a dynamic page needs it.
import { BOUND_FIELD, tagModule } from "./actions-runtime";
import { cacheControl, ResponseCache } from "./cache";
import { setRevalidator, withStore, type RequestStore } from "./context";
import { apiStaticPath, htmlPath, ogPath, type Manifest, type ManifestRoute, type ManifestSlot } from "./manifest";
import { inScope, matchRoute, matchSegments } from "./match";
import { fnv, send, type StaticEntry } from "./static";
import type { LocaleInfo } from "./runtime";
import type { RenderInput, Rendered, SlotInput } from "./render";
import { DRAFT_COOKIE, setDraftToken } from "./server-api";
import type { ApiContext, ApiModule, ErrorModule, LayoutModule, Locals, Middleware, MiddlewareContext, PageModule, ResolvedConfig, RouteCache } from "./types";

export interface Platform {
  /** Loads a project module by its path relative to the project root ("app/routes/x.tsx"). */
  load(file: string): Promise<unknown>;
  hash?(data: Uint8Array | string): string;
  gzip?(data: Uint8Array): Uint8Array;
  brotli?(data: Uint8Array): Uint8Array;
  /** The image optimizer behind /_optz/image (needs a native image library). */
  images?(req: Request, url: URL, files: Map<string, StaticEntry>): Promise<Response>;
  /** Renders an Open Graph image component to PNG. */
  og?(mod: unknown, props: Record<string, unknown>): Promise<Uint8Array>;
}

export interface AppOptions {
  manifest: Manifest;
  config: ResolvedConfig;
  files: Map<string, StaticEntry>;
  platform: Platform;
  middleware?: Middleware[];
  dev?: boolean;
  /** `optz build`: render static pages and shells instead of serving them from `files`. */
  prerender?: boolean;
}

export interface App {
  fetch(req: Request): Promise<Response>;
  cache: ResponseCache | null;
}

const jsonRes = (v: unknown, status = 200, extra?: Record<string, string>) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", ...extra } });

/** Streamed responses carry their CSP nonce in this header until middleware is done; then it
 *  is added to the Content-Security-Policy and removed. */
const NONCE = "x-optz-nonce";

function withNonce(res: Response, nonce: string): Response {
  const csp = res.headers.get("content-security-policy");
  if (!csp) return res;
  const add = `'nonce-${nonce}'`;
  const directives = csp.split(";").map((d) => d.trim());
  const i = directives.findIndex((d) => d.startsWith("script-src "));
  if (i >= 0) directives[i] += ` ${add}`;
  else {
    const def = directives.find((d) => d.startsWith("default-src "));
    directives.push(`script-src ${def ? def.slice("default-src ".length) : "'self'"} ${add}`);
  }
  res.headers.set("Content-Security-Policy", directives.join("; "));
  return res;
}

/** Best locale for an Accept-Language header. */
export function pickLocale(header: string | null, locales: string[]): string | undefined {
  const wanted = (header ?? "")
    .split(",")
    .map((p) => {
      const [tag, q] = p.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { tag } of wanted) {
    const exact = locales.find((l) => l.toLowerCase() === tag);
    if (exact) return exact;
    const base = locales.find((l) => l.toLowerCase().split("-")[0] === tag.split("-")[0]);
    if (base) return base;
  }
  return undefined;
}

export async function createApp({ manifest, config, files, platform, middleware = [], dev, prerender }: AppOptions): Promise<App> {
  const F = config.features;
  /** Serve built files (production) rather than rendering (dev, build). */
  const live = !dev && !prerender;
  const hash = platform.hash ?? fnv;
  const cache = F.cache && !prerender ? new ResponseCache(config.cache.maxEntries, config.cache.maxBytes, { hash, gzip: platform.gzip, brotli: platform.brotli }) : null;
  const modules = new Map<string, Promise<unknown>>();
  const load = <T,>(f: string) => {
    let m = modules.get(f);
    if (!m) modules.set(f, (m = platform.load(f)));
    return m as Promise<T>;
  };
  // Loaded on first use: a fully static site never pays for React's server renderer.
  let renderMod: Promise<typeof import("./render")> | undefined;
  const render = () => (renderMod ??= import("./render"));
  const proxies = Object.entries(config.proxy ?? {}).sort((a, b) => b[0].length - a[0].length);
  const assets = (r?: ManifestRoute) => ({ entry: manifest.entry, css: manifest.css, preload: r?.preload ?? [], islands: manifest.islands, fonts: manifest.fonts, dev });
  const i18n = config.i18n;

  // Server Actions are tagged up front so pages that render <form action={fn}> get real URLs.
  if (F.actions) for (const [id, a] of Object.entries(manifest.actions ?? {})) await tagModule((await load<Record<string, unknown>>(a.file)) as Record<string, unknown>, id, a);

  // Prerendered API responses keep their content type.
  for (const s of Object.values(manifest.apiStatic ?? {})) {
    const f = files.get(s.file);
    if (f) files.set(s.file, { ...f, type: s.type, cache: "no-cache" });
  }

  // ---- draft mode: a cookie signed with the secret ----
  const secret = config.draft?.secret ?? (typeof process !== "undefined" ? process.env.OPTZ_DRAFT_SECRET : undefined) ?? crypto.randomUUID();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("optz-draft")));
  const draftValue = btoa(String.fromCharCode(...sig)).replace(/[+/=]/g, "");
  setDraftToken(() => draftValue);
  const isDraft = (req: Request) => {
    const c = req.headers.get("cookie");
    return !!c && c.includes(`${DRAFT_COOKIE}=${draftValue}`);
  };

  // ---- incremental static regeneration -------------------------------------------------------
  // Static files are fresh as of manifest.builtAt (or their last regeneration). They go stale
  // after `revalidate` seconds, or when revalidatePath/revalidateTag names them; the next
  // request gets the stale copy while one background render replaces it.
  const renderedAt = new Map<string, number>();
  const pathStamps = new Map<string, number>();
  const prefixStamps: Array<[string, number]> = [];
  const tagStamps = new Map<string, number>();
  const regenerating = new Set<string>();

  setRevalidator({
    path(path, type) {
      const now = Date.now();
      const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
      if (type === "layout") prefixStamps.push([p === "/" ? "/" : p + "/", now], [p, now]);
      else pathStamps.set(p, now);
      cache?.invalidate((k) => {
        const kp = k.split("\n")[0].split("?")[0];
        return type === "layout" ? kp === p || kp.startsWith(p === "/" ? "/" : p + "/") : kp === p;
      });
    },
    tag(tag) {
      tagStamps.set(tag, Date.now());
      cache?.invalidate((_k, rc) => !!rc.tags?.includes(tag));
    },
  });

  function isStale(path: string, r: ManifestRoute): boolean {
    const at = renderedAt.get(path) ?? manifest.builtAt;
    if (r.revalidate !== undefined && Date.now() - at > r.revalidate * 1000) return true;
    if ((pathStamps.get(path) ?? 0) > at) return true;
    for (const [prefix, t] of prefixStamps) if (t > at && (path === prefix || path.startsWith(prefix))) return true;
    for (const t of r.tags ?? []) if ((tagStamps.get(t) ?? 0) > at) return true;
    return false;
  }

  const entryOf = (body: Uint8Array, type: string, cacheHeader: string): StaticEntry => {
    const text = /text|json|javascript|xml|svg/.test(type) && body.length > 512;
    return { body, type, etag: `"${hash(body)}"`, cache: cacheHeader, gz: text ? platform.gzip?.(body) : undefined, br: text ? platform.brotli?.(body) : undefined };
  };

  function regenerate(ctx: MiddlewareContext, r: ManifestRoute, publicPath: string, inner: string, params: Record<string, string>, locale?: string) {
    if (regenerating.has(publicPath)) return;
    regenerating.add(publicPath);
    const started = Date.now();
    (async () => {
      if (r.kind === "api") {
        const mod = await load<Record<string, unknown>>(r.file);
        const res = await (mod.GET as (c: ApiContext) => Promise<Response>)({ ...ctx, params });
        if (res.status !== 200) return;
        files.set(apiStaticPath(publicPath), entryOf(new Uint8Array(await res.arrayBuffer()), res.headers.get("content-type") ?? "application/json", "no-cache"));
      } else {
        const { renderPage } = await render();
        const out = await renderPage(await renderInput(r, ctx, publicPath, inner, params, locale), assets(r), config);
        if (out.kind === "notFound") files.delete(htmlPath(publicPath));
        if (out.kind !== "page" || out.status !== 200) return;
        files.set(htmlPath(publicPath), entryOf(new TextEncoder().encode(out.html), "text/html; charset=utf-8", "no-cache"));
      }
      renderedAt.set(publicPath, started);
    })()
      .catch((e) => console.error(`optz: regenerating ${publicPath} failed (serving the previous version):`, e))
      .finally(() => regenerating.delete(publicPath));
  }

  // ---- rendering -------------------------------------------------------------------------------
  const localeInfo = (locale?: string): LocaleInfo | undefined =>
    i18n && locale ? { locale, locales: i18n.locales, defaultLocale: i18n.defaultLocale, prefixDefault: i18n.prefixDefault } : undefined;
  const localized = (inner: string, l: string) => (i18n && (l !== i18n.defaultLocale || i18n.prefixDefault) ? `/${l}${inner === "/" ? "" : inner}` : inner);

  async function slotInputs(r: ManifestRoute, inner: string, override?: { slot: ManifestSlot; route: ManifestRoute; params: Record<string, string> }) {
    if (!manifest.slots?.length) return undefined;
    return Promise.all(
      r.layouts.map(async (layout) => {
        const slots = manifest.slots.filter((s) => s.layout === layout);
        if (!slots.length) return undefined;
        const out: Record<string, SlotInput | null> = {};
        for (const s of slots) {
          if (override?.slot === s) {
            out[s.name] = { page: await load<PageModule>(override.route.file), params: override.params };
            continue;
          }
          const m = matchRoute(s.routes, inner);
          if (m) out[s.name] = { page: await load<PageModule>(m.route.file), params: m.params };
          else out[s.name] = s.default ? { page: await load<PageModule>(s.default), params: {} } : null;
        }
        return out;
      }),
    );
  }

  async function renderInput(
    r: ManifestRoute,
    ctx: MiddlewareContext,
    publicPath: string,
    inner: string,
    params: Record<string, string>,
    locale?: string,
    draft = false,
    slotOverride?: Parameters<typeof slotInputs>[2],
  ): Promise<RenderInput> {
    const head: Promise<unknown>[] = [load(r.file), Promise.all(r.layouts.map((l) => load(l))), r.error ? load(r.error) : Promise.resolve(undefined), r.loading ? load(r.loading) : Promise.resolve(undefined)];
    const [page, layouts, error, loading] = await Promise.all(head);
    const input: RenderInput = {
      page: page as PageModule,
      layouts: layouts as LayoutModule[],
      error: error as ErrorModule | undefined,
      loading: loading as RenderInput["loading"],
      slots: await slotInputs(r, inner, slotOverride),
      pattern: r.pattern,
      segments: r.segments,
      render: r.render,
      pathname: publicPath,
      params,
      og: r.og ? ogPath(publicPath) : undefined,
      i18n: localeInfo(locale),
      ctx: { url: ctx.url, request: ctx.request, locals: ctx.locals, locale, draft },
    };
    if (i18n) {
      const langs: Record<string, string> = {};
      for (const l of i18n.locales) langs[l] = localized(inner, l);
      const orig = input.page.head;
      input.page = { ...input.page, head: (d, c) => ({ alternates: { languages: langs }, ...orig?.(d as never, c) }) } as PageModule;
    }
    return input;
  }

  function html(body: string, req: Request, status = 200, extra?: Record<string, string>): Response {
    const h: Record<string, string> = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", Vary: "Accept-Encoding", ...extra };
    if (F.etag && status === 200) {
      const etag = `"${hash(body)}"`;
      h.ETag = etag;
      if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: h });
    }
    if (F.dynamicCompression && platform.gzip && body.length > 1024 && (req.headers.get("accept-encoding") ?? "").includes("gzip")) {
      h["Content-Encoding"] = "gzip";
      return new Response(platform.gzip(new TextEncoder().encode(body)) as BodyInit, { status, headers: h });
    }
    return new Response(body, { status, headers: h });
  }

  async function finish(out: Rendered, ctx: MiddlewareContext, extra?: Record<string, string>): Promise<Response> {
    if (out.kind === "redirect") return out.response;
    if (out.kind === "notFound") return notFound(ctx);
    if (out.kind === "stream") {
      return new Response(out.stream, {
        status: out.status,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no", [NONCE]: out.nonce, ...extra },
      });
    }
    return html(out.html, ctx.request, out.status, extra);
  }

  const withCache = (ctx: MiddlewareContext, rc: RouteCache | undefined, produce: () => Promise<Response>) => {
    rc ??= config.cache.default;
    if (!cache || !rc || (ctx.request.method !== "GET" && ctx.request.method !== "HEAD")) return produce();
    return cache.handle(ctx.request, ResponseCache.key(ctx.request, ctx.url, rc), rc, produce);
  };

  async function notFound(ctx: MiddlewareContext, locale?: string): Promise<Response> {
    const f = (locale && files.get(`/${locale}/404.html`)) || files.get("/404.html");
    if (f) return send(f, ctx.request, 404);
    if (manifest.notFound) {
      const { renderPage } = await render();
      const page = await load<PageModule>(manifest.notFound);
      const layouts = await Promise.all(manifest.rootLayouts.map((l) => load<LayoutModule>(l)));
      const r = await renderPage(
        { page, layouts, pattern: "/_404", pathname: ctx.url.pathname, params: {}, i18n: localeInfo(locale), ctx: { url: ctx.url, locals: ctx.locals, locale } },
        assets(),
        config,
      );
      if (r.kind === "page") return html(r.html, ctx.request, 404);
    }
    return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
  }

  async function data(ctx: MiddlewareContext): Promise<Response> {
    const p = ctx.url.pathname;
    if (live) {
      const f = files.get(p);
      if (f) return send(f, ctx.request);
    }
    const pathname = p.slice("/_optz/data".length, -".json".length);
    const target = pathname === "/index" ? "/" : pathname;
    const { locale, inner } = splitLocale(target);
    const m = matchRoute(manifest.routes, inner);
    if (!m || m.route.kind !== "page" || (live && m.route.render !== "dynamic" && !m.route.dynamicParams)) return jsonRes({ error: "not found" }, 404);
    const route = m.route;
    const input = await renderInput(route, ctx, target, inner, m.params, locale);
    return withCache(ctx, input.page.cache, async () => {
      const { loadData } = await render();
      const r = await loadData(input);
      if (r.kind === "redirect") return jsonRes({ redirect: r.response.headers.get("Location") });
      if (r.kind === "notFound") return jsonRes({ error: "not found" }, 404);
      return jsonRes(r.payload);
    });
  }

  function splitLocale(path: string): { locale?: string; inner: string; prefixed: boolean } {
    if (!i18n) return { inner: path, prefixed: false };
    const first = path.split("/")[1];
    if (first && i18n.locales.includes(first)) return { locale: first, inner: path.slice(first.length + 1) || "/", prefixed: true };
    return { locale: i18n.defaultLocale, inner: path, prefixed: false };
  }

  // ---- Server Actions ---------------------------------------------------------------------------
  async function action(ctx: MiddlewareContext, s: RequestStore): Promise<Response> {
    const { request: req, url } = ctx;
    const [, , , id, rawName] = url.pathname.split("/");
    const name = decodeURIComponent(rawName ?? "");
    const def = manifest.actions?.[id];
    if (!F.actions || !def || !def.exports.includes(name)) return jsonRes({ ok: false, error: "No such action." }, 404);
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const mode = req.headers.get("x-optz-action");
    // CSRF: calls from our client send a custom header (which needs CORS to send cross-site);
    // plain form posts must come from this site.
    if (!mode) {
      const origin = req.headers.get("origin");
      const site = req.headers.get("sec-fetch-site");
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
      const ok = origin ? new URL(origin).host === host : site === "same-origin";
      if (!ok) return new Response("Cross-site form posts aren't allowed.", { status: 403 });
    }
    const fn = (await load<Record<string, unknown>>(def.file))[name] as (...a: unknown[]) => unknown;
    let args: unknown[];
    if (mode === "json") {
      args = (await req.json().catch(() => null)) as unknown[];
      if (!Array.isArray(args)) return jsonRes({ ok: false, error: "Bad arguments." }, 400);
    } else {
      const fd = await req.formData().catch(() => null);
      if (!fd) return jsonRes({ ok: false, error: "Bad form data." }, 400);
      const lead: unknown[] = [];
      for (const field of ["$optz_args", BOUND_FIELD]) {
        const v = fd.get(field);
        if (typeof v === "string") lead.push(...(JSON.parse(v) as unknown[]));
        fd.delete(field);
      }
      // React's progressive-enhancement fields for bound/hidden data.
      for (const k of [...fd.keys()]) if (k.startsWith("$ACTION")) fd.delete(k);
      args = [...lead, fd];
    }
    const back = () => {
      const ref = req.headers.get("referer");
      return ref && new URL(ref).host === url.host ? new URL(ref).pathname + new URL(ref).search : "/";
    };
    try {
      const value = await fn(...args);
      if (!mode) return new Response(null, { status: 303, headers: { Location: back() } });
      return jsonRes({ ok: true, value: value ?? null, revalidated: s.revalidated || undefined });
    } catch (e) {
      if (e instanceof Response && e.headers.get("location")) {
        const loc = e.headers.get("location")!;
        return mode ? jsonRes({ ok: true, redirect: loc, revalidated: s.revalidated || undefined }) : new Response(null, { status: 303, headers: { Location: loc } });
      }
      const { ActionError } = await import("./server-api");
      const msg = e instanceof ActionError || dev ? (e as Error).message : "Something went wrong.";
      if (!(e instanceof ActionError)) console.error(`optz: action ${def.file}#${name}:`, e);
      // An ActionError is an expected outcome ("write something first"), not a failed request.
      if (e instanceof ActionError) return mode ? jsonRes({ ok: false, error: msg }) : new Response(msg, { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      return mode ? jsonRes({ ok: false, error: msg }, 500) : new Response(msg, { status: 500 });
    }
  }

  // ---- Open Graph images for pages rendered at request time ------------------------------------
  async function og(ctx: MiddlewareContext): Promise<Response> {
    const f = files.get(ctx.url.pathname);
    if (f) return send(f, ctx.request);
    if (!platform.og) return notFound(ctx);
    const path = ctx.url.pathname.slice("/_optz/og".length, -".png".length);
    const target = path === "/index" ? "/" : path;
    const { locale, inner } = splitLocale(target);
    const m = matchRoute(manifest.routes, inner);
    if (!m?.route.og) return notFound(ctx);
    const route = m.route;
    return withCache(ctx, { maxAge: 3600, staleWhileRevalidate: 86400 }, async () => {
      const page = await load<PageModule>(route.file);
      let data: unknown = null;
      if (page.loader) data = await page.loader({ url: ctx.url, request: ctx.request, locals: ctx.locals, params: m.params, locale });
      const png = await platform.og!(await load(route.og!), { params: m.params, data, locale });
      return new Response(png as BodyInit, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600" } });
    });
  }

  // ---- routing ------------------------------------------------------------------------------
  async function route(ctx: MiddlewareContext, s: RequestStore): Promise<Response> {
    const { request: req, url } = ctx;
    const p = url.pathname;
    if (p.length > 1 && p.endsWith("/")) return new Response(null, { status: 308, headers: { Location: p.replace(/\/+$/, "") + url.search } });
    if (p.startsWith("/_optz/action/")) return action(ctx, s);
    if (p.startsWith("/_optz/data/") && p.endsWith(".json")) return data(ctx);
    if (p.startsWith("/_optz/og/") && p.endsWith(".png")) return og(ctx);
    if (p === "/_optz/404" && prerender) return notFound(ctx, url.searchParams.get("locale") ?? undefined);
    if (p === "/_optz/image") return F.images && platform.images ? platform.images(req, url, files) : notFound(ctx);
    if (p.startsWith("/_optz/")) return notFound(ctx);

    // i18n: /fr/x -> locale fr, route /x. The default locale has no prefix unless prefixDefault.
    const { locale, inner, prefixed } = splitLocale(p);
    s.locale = locale;
    if (i18n && locale) {
      if (prefixed && locale === i18n.defaultLocale && !i18n.prefixDefault) return new Response(null, { status: 308, headers: { Location: inner + url.search } });
      if (!prefixed && (i18n.prefixDefault || (p === "/" && i18n.detect !== false))) {
        const cookie = req.headers.get("cookie")?.match(/(?:^|;\s*)optz-locale=([^;]+)/)?.[1];
        const want = (cookie && i18n.locales.includes(cookie) ? cookie : undefined) ?? (p === "/" && i18n.detect !== false ? pickLocale(req.headers.get("accept-language"), i18n.locales) : undefined) ?? i18n.defaultLocale;
        if (want !== i18n.defaultLocale || i18n.prefixDefault) return new Response(null, { status: 307, headers: { Location: localized(inner, want) + url.search, Vary: "Accept-Language, Cookie" } });
      }
    }

    const redir = manifest.redirects[p];
    if (redir) return new Response(null, { status: redir.status, headers: { Location: redir.location } });

    // Intercepting routes: in-app navigation from inside their folder.
    const from = req.headers.get("x-optz-swap") ? req.headers.get("x-optz-from") : null;
    if (from && (manifest.intercepts?.length || manifest.slots?.some((x) => x.intercepts.length))) {
      const fromInner = splitLocale(from).inner;
      const headers = { "Cache-Control": "no-store", Vary: "X-Optz-From" };
      for (const slot of manifest.slots ?? []) {
        for (const ir of slot.intercepts) {
          const params = matchSegments(ir.segments, inner);
          if (!params || !ir.scope || !inScope(ir.scope, fromInner)) continue;
          const under = matchRoute(manifest.routes, fromInner);
          if (!under || under.route.kind !== "page" || !under.route.layouts.includes(slot.layout)) continue;
          const { renderPage } = await render();
          const input = await renderInput(under.route, ctx, p, fromInner, under.params, locale, false, { slot, route: ir, params });
          return finish(await renderPage(input, assets(under.route), config), ctx, headers);
        }
      }
      for (const ir of manifest.intercepts ?? []) {
        const params = matchSegments(ir.segments, inner);
        if (!params || !ir.scope || !inScope(ir.scope, fromInner)) continue;
        const { renderPage } = await render();
        return finish(await renderPage(await renderInput(ir, ctx, p, inner, params, locale), assets(ir), config), ctx, headers);
      }
    }

    const m = matchRoute(manifest.routes, inner);
    if (!m) {
      const f = files.get(p);
      if (f && !p.endsWith(".html")) return send(f, req);
      return notFound(ctx, locale);
    }
    const r = m.route;
    if (r.kind === "api") {
      if (!F.api) return notFound(ctx);
      if (r.prerendered && (req.method === "GET" || req.method === "HEAD") && live) {
        const f = files.get(apiStaticPath(p));
        if (f) {
          if (isStale(p, r)) regenerate(ctx, r, p, inner, m.params, locale);
          return send(f, req);
        }
      }
      const mod = await load<Record<string, unknown> & ApiModule>(r.file);
      const handler = (mod[req.method] ?? (req.method === "HEAD" ? mod.GET : undefined)) as ((c: ApiContext) => Response | Promise<Response>) | undefined;
      if (typeof handler !== "function") {
        const allow = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].filter((k) => typeof mod[k] === "function").join(", ");
        return new Response(null, { status: 405, headers: { Allow: allow } });
      }
      const run = async () => {
        const res = await handler({ ...ctx, params: m.params });
        const rc = mod.cache ?? config.cache.default;
        if (rc && !res.headers.has("cache-control") && res.status === 200) res.headers.set("Cache-Control", cacheControl(rc));
        return res;
      };
      return req.method === "GET" || req.method === "HEAD" ? withCache(ctx, mod.cache, run) : run();
    }
    if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });

    const draft = r.render !== "dynamic" && isDraft(req);
    s.draft = draft || isDraft(req);
    if (live && !draft && r.render === "static") {
      const f = files.get(htmlPath(p));
      if (f) {
        if (isStale(p, r)) regenerate(ctx, r, p, inner, m.params, locale);
        return send(f, req);
      }
      if (!r.dynamicParams) return notFound(ctx, locale);
      // Params paths() didn't list: render once, keep it like a built page (bounded by the cache).
      const input = await renderInput(r, ctx, p, inner, m.params, locale);
      return withCache(ctx, { maxAge: r.revalidate ?? 31536000, staleWhileRevalidate: r.revalidate ? 31536000 : undefined, tags: r.tags }, async () => {
        const { renderPage } = await render();
        return finish(await renderPage(input, assets(r), config), ctx);
      });
    }
    if (live && !draft && r.render === "client" && r.shell) {
      const f = files.get(r.shell);
      if (f) return send(f, req);
    }
    // Client-rendered shells are built once for every param value: no params, no loader.
    const shell = r.render === "client";
    const input = await renderInput(r, ctx, shell && prerender ? r.pattern : p, inner, shell && prerender ? {} : m.params, locale, draft);
    if (shell) input.skipLoader = true;
    const rc = r.render === "dynamic" && !draft ? (input.page.cache ?? config.cache.default) : undefined;
    const stream = F.streaming && !prerender && r.render === "dynamic" && !(cache && rc);
    const produce = async () => {
      const { renderPage } = await render();
      return finish(await renderPage(input, assets(r), config, { stream }), ctx, draft ? { "Cache-Control": "private, no-store" } : undefined);
    };
    return rc ? withCache(ctx, rc, produce) : produce();
  }

  const run = (ctx: MiddlewareContext, s: RequestStore, i: number): Promise<Response> =>
    i < middleware.length ? Promise.resolve(middleware[i](ctx, () => run(ctx, s, i + 1))) : route(ctx, s);

  async function fetch(req: Request): Promise<Response> {
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
          return await globalThis.fetch(target.origin + path + url.search, { method: req.method, headers, body: req.body, redirect: "manual" });
        } catch {
          return jsonRes({ error: `upstream ${target.origin} is not reachable` }, 502);
        }
      }
    }
    const ctx: MiddlewareContext = { request: req, url, locals: {} as Locals };
    const t0 = F.requestLog ? performance.now() : 0;
    try {
      const res = await withStore({ request: req, url, locals: ctx.locals, draft: false }, (s) => run(ctx, s, 0));
      const nonce = res.headers.get(NONCE);
      if (nonce) {
        res.headers.delete(NONCE);
        withNonce(res, nonce);
      }
      if (F.requestLog) console.log(`${req.method} ${p} ${res.status} ${(performance.now() - t0).toFixed(1)}ms`);
      return res;
    } catch (e) {
      console.error(`optz: ${req.method} ${p}:`, e);
      const msg = dev ? `<pre>${String((e as Error)?.stack ?? e).replace(/[&<>]/g, (c) => `&#${c.charCodeAt(0)};`)}</pre>` : "<h1>Internal server error</h1>";
      return new Response(`<!doctype html><meta charset="utf-8"><title>Error</title>${msg}`, { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
  }

  return { fetch, cache };
}
