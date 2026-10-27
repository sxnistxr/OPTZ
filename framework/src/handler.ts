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
import { als, clearDataCaches, inStore, newStore, setRevalidator, type RequestStore } from "./context";
import { apiStaticPath, htmlPath, ogPath, type Manifest, type ManifestRoute, type ManifestSlot } from "./manifest";
import { compilePattern, fillDestination, inScope, matchRoute, matchSegments, safeDecode } from "./match";
import { fnv, send, type StaticEntry } from "./static";
import type { LocaleInfo } from "./runtime";
import type { RenderInput, Rendered, SlotInput } from "./render";
import { DRAFT_COOKIE, setDraftToken } from "./server-api";
import type { ApiContext, ApiModule, ErrorModule, LayoutModule, Locals, Middleware, MiddlewareContext, PageModule, ResolvedConfig, RevalidationChange, RouteCache } from "./types";

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

/** What the platform passes per request: edge workers' bindings and waitUntil(). */
export interface RequestPlatform {
  env?: Record<string, unknown>;
  waitUntil?: (p: Promise<unknown>) => void;
}

export interface App {
  fetch(req: Request, platform?: RequestPlatform): Promise<Response>;
  cache: ResponseCache | null;
}

/** A middleware module's functions, limited to its `matcher` paths when it exports one:
 *  export const matcher = ["/admin/[...rest]", "/api/[...rest]"]   (route syntax). */
export function middlewareFrom(mod: { default?: Middleware | Middleware[]; matcher?: string | string[] }): Middleware[] {
  const list = mod.default ? (Array.isArray(mod.default) ? mod.default : [mod.default]) : [];
  if (!mod.matcher) return list;
  const patterns = (Array.isArray(mod.matcher) ? mod.matcher : [mod.matcher]).map(compilePattern);
  const matches = (p: string) => patterns.some((seg) => matchSegments(seg, p) !== null);
  return list.map((mw): Middleware => (ctx, next) => (matches(ctx.url.pathname) ? mw(ctx, next) : next()));
}

/** Hop-by-hop headers (RFC 9110) and forwarding headers a client could forge: never passed on. */
const HOP = /^(connection|keep-alive|proxy-authenticate|proxy-authorization|proxy-connection|te|trailer|transfer-encoding|upgrade|host|forwarded|x-forwarded-.*|x-real-ip)$/i;

const jsonRes = (v: unknown, status = 200, extra?: Record<string, string>) =>
  new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", ...extra } });

/** Streamed responses carry their CSP nonce in this header until middleware is done; then it
 *  is added to the Content-Security-Policy and removed. */
const NONCE = "x-optz-nonce";
/** Requests whose response streamed (so only they pay for the nonce header lookup). */
const streamed = new WeakSet<object>();

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
  // <Image> rendered on the server offers the widths the optimizer produces.
  if (config.images?.sizes) (globalThis as { __OPTZ_IMAGE_SIZES__?: number[] }).__OPTZ_IMAGE_SIZES__ = config.images.sizes;
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
  const proxies = Object.entries(config.proxy ?? {})
    .sort((a, b) => b[0].length - a[0].length)
    .map(([prefix, rule]) => ({ prefix, rule, target: new URL(rule.target) }));
  const proxyFor = (p: string) => proxies.find((x) => p === x.prefix || p.startsWith(x.prefix + "/"));
  // Config redirects, rewrites and headers, compiled once.
  const compiled = <T extends { source: string }>(list: T[] = []) => list.map((r) => ({ ...r, segments: compilePattern(r.source) }));
  const redirectRules = compiled(config.redirects);
  const rewriteRules = compiled(config.rewrites);
  const headerRules = compiled(config.headers);
  const firstMatch = <R extends { segments: ReturnType<typeof compilePattern> }>(rules: R[], path: string) => {
    for (const r of rules) {
      const params = matchSegments(r.segments, path);
      if (params) return { rule: r, params };
    }
    return null;
  };

  /** Forwards a request to a proxy target: the target's path is kept, hop-by-hop and
   *  client-sent forwarding headers are dropped (and set from what this server knows), bodies
   *  are capped, and a target that doesn't answer in time is a 504. */
  async function proxy(req: Request, url: URL, x: (typeof proxies)[number]): Promise<Response> {
    const { prefix, rule, target } = x;
    const rest = rule.strip ? url.pathname.slice(prefix.length) || "/" : url.pathname;
    const dest = new URL(target.pathname.replace(/\/+$/, "") + rest + url.search, target.origin);
    const limit = rule.maxBodySize ?? config.server.maxRequestBodySize;
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > limit) return jsonRes({ error: "request body too large" }, 413);
    const headers = new Headers();
    req.headers.forEach((v, k) => {
      if (!HOP.test(k)) headers.set(k, v);
    });
    const trusted = config.server.trustProxy;
    const xff = trusted ? req.headers.get("x-forwarded-for") : null;
    if (xff) headers.set("X-Forwarded-For", xff);
    headers.set("X-Forwarded-Host", (trusted && req.headers.get("x-forwarded-host")) || url.host);
    headers.set("X-Forwarded-Proto", (trusted && req.headers.get("x-forwarded-proto")) || url.protocol.slice(0, -1));
    const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body;
    let body: BodyInit | undefined;
    if (hasBody) {
      const buf = new Uint8Array(await req.arrayBuffer());
      if (buf.length > limit) return jsonRes({ error: "request body too large" }, 413);
      body = buf;
    }
    try {
      const res = await globalThis.fetch(dest, { method: req.method, headers, body, redirect: "manual", signal: AbortSignal.timeout(rule.timeoutMs ?? 30_000) });
      // A copy with mutable headers, so middleware can still add its own.
      const out = new Headers();
      res.headers.forEach((v, k) => {
        if (!/^(connection|keep-alive|transfer-encoding|content-encoding|content-length)$/i.test(k)) out.append(k, v);
      });
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
    } catch (e) {
      const timedOut = (e as Error)?.name === "TimeoutError";
      return jsonRes({ error: timedOut ? `upstream ${target.origin} didn't answer in time` : `upstream ${target.origin} is not reachable` }, timedOut ? 504 : 502);
    }
  }
  const assets = (r?: ManifestRoute) => ({ entry: manifest.entry, css: manifest.css, preload: r?.preload ?? [], islands: manifest.islands, fonts: manifest.fonts, dev, build: manifest.builtAt });
  const i18n = config.i18n;

  // Server Actions are tagged up front so pages that render <form action={fn}> get real URLs.
  if (F.actions) for (const [id, a] of Object.entries(manifest.actions ?? {})) await tagModule((await load<Record<string, unknown>>(a.file)) as Record<string, unknown>, id, a);

  // HTML pages: speculation rules (prerender on hover in Chromium) and the CDN cache policy.
  const SPECULATION = '"/_optz/speculation.json"';
  const htmlCache = config.server.cdnMaxAge ? `public, max-age=0, s-maxage=${config.server.cdnMaxAge}, stale-while-revalidate=86400` : "no-cache";
  const pageHeaders: Record<string, string> = config.client.speculation && config.client.mode === "islands" && live && files.has("/_optz/speculation.json") ? { "Speculation-Rules": SPECULATION } : {};
  // With a CDN caching pages, each carries tags to purge it by: its path and the page's tags.
  const cdnTagged = !!config.server.cdnMaxAge;
  const pageHeadersFor = (path: string): Record<string, string> => {
    if (!cdnTagged) return pageHeaders;
    const route = matchRoute(manifest.routes, splitLocale(path).inner)?.route;
    const tags = [`optz-path:${path}`, ...(route?.tags ?? [])];
    return { ...pageHeaders, "Cache-Tag": tags.join(","), "Surrogate-Key": tags.join(" ") };
  };
  for (const [url, e] of files) {
    if (!e.type.startsWith("text/html")) continue;
    const internal = url.startsWith("/_optz/") || /(^|\/)404\.html$/.test(url);
    e.headers = { ...e.headers, ...(internal ? pageHeaders : pageHeadersFor(url === "/index.html" ? "/" : url.replace(/\/index\.html$/, ""))) };
    if (!url.startsWith("/_optz/")) e.cache = htmlCache;
  }

  // Prerendered API responses keep their content type.
  for (const s of Object.values(manifest.apiStatic ?? {})) {
    const f = files.get(s.file);
    if (f) files.set(s.file, { ...f, type: s.type, cache: "no-cache" });
  }

  // ---- MCP: app/mcp tools, prompts and resources for AI clients (loaded on first request) ----
  const mcpPath = config.mcp?.path ?? "/mcp";
  const mcpOn = F.mcp && !prerender && (!!manifest.mcp?.length || !!config.mcp);
  let mcpServer: Promise<ReturnType<typeof import("./mcp").createMcpServer>> | undefined;
  const mcp = () =>
    (mcpServer ??= import("./mcp").then(async ({ createMcpServer, sitePages }) =>
      createMcpServer({
        config,
        dev,
        modules: await Promise.all((manifest.mcp ?? []).map(async (file) => ({ file, mod: await load(file) }))),
        pages: () => sitePages([...files].map(([u, e]): [string, Uint8Array] => [u, e.body]), (config.llms || undefined)?.exclude),
        // With middleware, a page is only readable over MCP if a GET for it, with the caller's
        // cookies and credentials, gets through: what the middleware protects stays protected.
        canRead: middleware.length
          ? async (path, c) => {
              const headers = new Headers();
              for (const h of ["cookie", "authorization"]) {
                const v = c.request.headers.get(h);
                if (v) headers.set(h, v);
              }
              const req = new Request(new URL(path, c.url), { headers });
              const url = new URL(req.url);
              const res = await run({ request: req, url, locals: {} as Locals }, newStore({ request: req, url, locals: {} as Locals, draft: false }), 0);
              await res.body?.cancel();
              return res.status === 200;
            }
          : undefined,
      }),
    ));

  // ---- draft mode: a cookie signed with the secret ----
  // The cookie is "<expiry>.<nonce>.<HMAC of both>": it expires (Max-Age and the signed expiry),
  // and each one is different, so a copied cookie stops working when it expires.
  const env = typeof process !== "undefined" ? process.env : ({} as Record<string, string | undefined>);
  const configured = config.draft?.secret || env.OPTZ_DRAFT_SECRET || undefined;
  const secret = configured ?? crypto.randomUUID();
  const draftMaxAge = config.draft?.maxAge ?? 86400;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64 = (s: string) => {
    try {
      return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  };
  // Signed synchronously from enable() would need a sync HMAC; instead tokens are pre-signed in
  // the background, a few at a time.
  const pool: string[] = [];
  const mint = async () => {
    const payload = `${Math.floor(Date.now() / 1000) + draftMaxAge}.${b64(crypto.getRandomValues(new Uint8Array(12)))}`;
    pool.push(`${payload}.${b64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))))}`);
  };
  await Promise.all([mint(), mint(), mint(), mint()]);
  let lastToken = pool[0];
  // With a random secret, only cookies set by this process can be valid: skip the check (a
  // header lookup on every static request) until draft mode is first turned on.
  let draftPossible = !!configured;
  let warned = false;
  setDraftToken(() => {
    draftPossible = true;
    if (!configured && !dev && !warned) {
      warned = true;
      console.warn("optz: draft mode without draft.secret or OPTZ_DRAFT_SECRET: cookies only work on this server process");
    }
    const value = pool.pop() ?? lastToken;
    lastToken = value;
    // Refill for the next enable(); a token minted now still expires draftMaxAge from now.
    void mint();
    return { value, maxAge: draftMaxAge };
  });
  const isDraft = async (req: Request): Promise<boolean> => {
    if (!draftPossible) return false;
    const header = req.headers.get("cookie");
    if (!header || !header.includes(DRAFT_COOKIE)) return false;
    const { parseCookies } = await import("./server-api");
    const v = parseCookies(header).get(DRAFT_COOKIE);
    const parts = v?.split(".");
    if (!parts || parts.length !== 3) return false;
    const exp = Number(parts[0]);
    if (!Number.isSafeInteger(exp) || exp < Date.now() / 1000) return false;
    const sig = unb64(parts[2]);
    return !!sig && crypto.subtle.verify("HMAC", key, sig as BufferSource, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
  };

  // ---- incremental static regeneration -------------------------------------------------------
  // Static files are fresh as of manifest.builtAt (or their last regeneration). They go stale
  // after `revalidate` seconds, or when revalidatePath/revalidateTag names them; the next
  // request gets the stale copy while one background render replaces it.
  const renderedAt = new Map<string, number>();
  // Bounded: past MAX_STAMPS the oldest are dropped and `floor` remembers them (a page rendered
  // before the floor counts as stale, which at worst costs an extra regeneration).
  const pathStamps = new Map<string, number>();
  const prefixStamps = new Map<string, number>();
  const tagStamps = new Map<string, number>();
  const MAX_STAMPS = 5000;
  let floor = 0;
  const stamp = (m: Map<string, number>, k: string, t: number) => {
    m.delete(k);
    m.set(k, t);
    while (m.size > MAX_STAMPS) {
      const [oldest, at] = m.entries().next().value as [string, number];
      m.delete(oldest);
      floor = Math.max(floor, at);
    }
  };
  const regenerating = new Set<string>();

  /** Applies a change in this process: ISR stamps and the response cache. */
  function applyChange(change: RevalidationChange) {
    const now = Date.now();
    anyStamps = true;
    for (const { path: p, prefix } of change.paths) {
      if (prefix) stamp(prefixStamps, p === "/" ? "/" : p + "/", now);
      stamp(pathStamps, p, now);
      cache?.invalidate((k) => {
        const kp = k.split("\n")[0].split("?")[0];
        return prefix ? kp === p || kp.startsWith(p === "/" ? "/" : p + "/") : kp === p;
      });
    }
    for (const tag of change.tags) {
      stamp(tagStamps, tag, now);
      cache?.invalidate((_k, rc) => !!rc.tags?.includes(tag));
    }
    clearDataCaches(change.tags);
  }

  // ---- revalidation beyond this process: peers and the CDN ----
  const rv = config.revalidation;
  const rvSecret = rv?.secret || (typeof process !== "undefined" ? process.env.OPTZ_REVALIDATE_SECRET : undefined) || "";
  const rvKey = rvSecret ? await crypto.subtle.importKey("raw", new TextEncoder().encode(rvSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]) : null;
  const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  if (rv?.peers?.length && !rvKey) console.warn("optz: revalidation.peers needs revalidation.secret (or OPTZ_REVALIDATE_SECRET); changes stay on this instance");

  /** A change made here: applied, sent to the peers and the CDN. */
  function publish(change: RevalidationChange) {
    applyChange(change);
    if (rvKey && rv?.peers?.length) {
      const body = JSON.stringify({ at: Date.now(), change });
      void crypto.subtle.sign("HMAC", rvKey, new TextEncoder().encode(body)).then((sig) => {
        for (const peer of rv.peers!) {
          globalThis
            .fetch(new URL("/_optz/revalidate", peer), { method: "POST", headers: { "Content-Type": "application/json", "X-Optz-Signature": hex(sig) }, body, signal: AbortSignal.timeout(5000) })
            .then((r) => r.ok || console.error(`optz: revalidating ${peer} answered ${r.status}`))
            .catch((e: Error) => console.error(`optz: revalidating ${peer} failed: ${e.message}`));
        }
      });
    }
    if (rv?.purge) {
      try {
        void Promise.resolve((rv.purge as (c: RevalidationChange, origin?: string) => unknown)(change, siteOrigin)).catch((e: Error) => console.error("optz: revalidation.purge:", e));
      } catch (e) {
        console.error("optz: revalidation.purge:", e);
      }
    }
  }

  /** POST /_optz/revalidate from a peer: a signed change, applied here only. */
  async function receiveRevalidation(req: Request): Promise<Response> {
    if (req.method !== "POST" || !rvKey) return jsonRes({ error: "not found" }, 404);
    const body = await req.text();
    const sig = req.headers.get("x-optz-signature") ?? "";
    const bytes = sig.match(/^[0-9a-f]{64}$/) ? Uint8Array.from(sig.match(/../g)!, (h) => parseInt(h, 16)) : null;
    if (!bytes || !(await crypto.subtle.verify("HMAC", rvKey, bytes, new TextEncoder().encode(body)))) return jsonRes({ error: "bad signature" }, 403);
    let msg: { at?: number; change?: RevalidationChange };
    try {
      msg = JSON.parse(body);
    } catch {
      return jsonRes({ error: "bad body" }, 400);
    }
    // Replays of an old message are refused.
    if (typeof msg.at !== "number" || Math.abs(Date.now() - msg.at) > 60_000 || !msg.change) return jsonRes({ error: "stale or malformed" }, 400);
    const paths = (msg.change.paths ?? []).filter((p) => typeof p?.path === "string" && p.path.startsWith("/"));
    const tags = (msg.change.tags ?? []).filter((t) => typeof t === "string");
    applyChange({ paths: paths.map((p) => ({ path: p.path, prefix: !!p.prefix })), tags });
    return jsonRes({ ok: true });
  }

  setRevalidator({
    path(path, type) {
      publish({ paths: [{ path: path.length > 1 ? path.replace(/\/+$/, "") : path, prefix: type === "layout" }], tags: [] });
    },
    tag(tag) {
      publish({ paths: [], tags: [tag] });
    },
  });

  let anyStamps = false;
  function isStale(path: string, r: ManifestRoute): boolean {
    // The common case, checked first: nothing can make this page stale.
    if (r.revalidate === undefined && !anyStamps) return false;
    const at = renderedAt.get(path) ?? manifest.builtAt;
    if (r.revalidate !== undefined && Date.now() - at > r.revalidate * 1000) return true;
    if (floor > at) return true;
    if ((pathStamps.get(path) ?? 0) > at) return true;
    for (const [prefix, t] of prefixStamps) if (t > at && (path === prefix || path.startsWith(prefix))) return true;
    for (const t of r.tags ?? []) if ((tagStamps.get(t) ?? 0) > at) return true;
    return false;
  }

  const entryOf = (body: Uint8Array, type: string, cacheHeader: string): StaticEntry => {
    const text = /text|json|javascript|xml|svg/.test(type) && body.length > 512;
    return { body, type, etag: `"${hash(body)}"`, cache: cacheHeader, gz: text ? platform.gzip?.(body) : undefined, br: text ? platform.brotli?.(body) : undefined };
  };

  /** A request with no cookies, credentials or other headers, for rendering what everyone gets
   *  (ISR, on-demand static pages): one visitor's request must never shape a shared page. */
  const anonymous = (url: URL, publicPath: string): MiddlewareContext => {
    const u = new URL(publicPath, url.origin);
    return { request: new Request(u), url: u, locals: {} as Locals };
  };

  function regenerate(trigger: MiddlewareContext, r: ManifestRoute, publicPath: string, inner: string, params: Record<string, string>, locale?: string) {
    if (regenerating.has(publicPath)) return;
    regenerating.add(publicPath);
    const started = Date.now();
    const ctx = anonymous(trigger.url, publicPath);
    // Its own request store, too: headers() and cookies() in the loader see the anonymous request.
    als.run(newStore({ request: ctx.request, url: ctx.url, locals: ctx.locals, locale, draft: false }), () => (async () => {
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
        files.set(htmlPath(publicPath), { ...entryOf(new TextEncoder().encode(out.html), "text/html; charset=utf-8", htmlCache), headers: pageHeadersFor(publicPath) });
      }
      renderedAt.set(publicPath, started);
    })()
      .catch((e) => console.error(`optz: regenerating ${publicPath} failed (serving the previous version):`, e))
      .finally(() => regenerating.delete(publicPath)));
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
    const h: Record<string, string> = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", Vary: "Accept-Encoding", ...pageHeaders, ...extra };
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
      streamed.add(ctx);
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
    const vary = new Set(["accept-encoding", ...(rc.vary ?? []).map((v) => v.toLowerCase())]);
    return cache.handle(ctx.request, ResponseCache.key(ctx.request, ctx.url, rc), rc, async () => {
      const res = await produce();
      // It read request headers (headers(), cookies()) the route doesn't vary on: the response is
      // this visitor's, so it's neither stored nor shared by a CDN.
      const reads = als.getStore()?.reads;
      if (reads && [...reads].some((h) => !vary.has(h)) && !res.headers.get("vary")?.includes("*")) {
        res.headers.set("Cache-Control", "private, no-store");
      }
      return res;
    });
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

  async function data(ctx: MiddlewareContext, s: RequestStore): Promise<Response> {
    const p = ctx.url.pathname;
    const draft = s.draft;
    if (live && !draft) {
      const f = files.get(p);
      if (f) return send(f, ctx.request);
    }
    const pathname = p.slice("/_optz/data".length, -".json".length);
    const target = pathname === "/index" ? "/" : pathname;
    const { locale, inner } = splitLocale(target);
    s.locale = locale;
    const m = matchRoute(manifest.routes, inner);
    if (!m || m.route.kind !== "page" || (live && !draft && m.route.render !== "dynamic" && !m.route.dynamicParams)) return jsonRes({ error: "not found" }, 404);
    const route = m.route;
    const input = await renderInput(route, ctx, target, inner, m.params, locale, draft);
    const produce = async () => {
      const { loadData, headTags } = await render();
      const r = await loadData(input);
      const extra = draft ? { "Cache-Control": "private, no-store" } : undefined;
      if (r.kind === "redirect") return jsonRes({ redirect: r.response.headers.get("Location") }, 200, extra);
      if (r.kind === "notFound") return jsonRes({ error: "not found" }, 404, extra);
      // The SPA router swaps the same head tags a full page load would have.
      return jsonRes({ ...r.payload, headHtml: headTags(r.payload.head, config, target, localeInfo(locale)), lang: locale ?? config.lang }, 200, extra);
    };
    // Draft data is per viewer: never from or into the shared cache.
    return draft ? produce() : withCache(ctx, input.page.cache, produce);
  }

  function splitLocale(path: string): { locale?: string; inner: string; prefixed: boolean } {
    if (!i18n) return { inner: path, prefixed: false };
    const first = path.split("/")[1];
    if (first && i18n.locales.includes(first)) return { locale: first, inner: path.slice(first.length + 1) || "/", prefixed: true };
    return { locale: i18n.defaultLocale, inner: path, prefixed: false };
  }

  // ---- same-origin checks ------------------------------------------------------------------------
  // The site's public origin comes from config (site.url), never from what a client says: Host
  // and X-Forwarded-Host are request headers anyone can set (X-Forwarded-Host only counts with
  // server.trustProxy). Without site.url, the request's own origin is the best there is.
  const siteOrigin = (() => {
    try {
      return config.site?.url ? new URL(config.site.url).origin : undefined;
    } catch {
      return undefined;
    }
  })();
  const loopback = (host: string) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  function sameSite(req: Request, url: URL, value: string | null): boolean {
    if (!value) return false;
    let o: URL;
    try {
      o = new URL(value);
    } catch {
      return false;
    }
    if (siteOrigin && o.origin === siteOrigin) return true;
    const fwd = config.server.trustProxy ? req.headers.get("x-forwarded-host") : null;
    const proto = config.server.trustProxy ? req.headers.get("x-forwarded-proto") : null;
    if (fwd) return o.host === fwd && (!proto || o.protocol === proto + ":");
    // With site.url set, another host is only trusted on a loopback name (dev); without it, the
    // request's own host is all we know.
    if (siteOrigin && !loopback(url.host)) return false;
    return o.host === url.host;
  }

  // ---- Server Actions ---------------------------------------------------------------------------
  async function action(ctx: MiddlewareContext, s: RequestStore): Promise<Response> {
    const { request: req, url } = ctx;
    const [, , , id, rawName] = url.pathname.split("/");
    const name = safeDecode(rawName ?? "") ?? "";
    const def = manifest.actions?.[id];
    if (!F.actions || !def || !def.exports.includes(name)) return jsonRes({ ok: false, error: "No such action." }, 404);
    if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const mode = req.headers.get("x-optz-action");
    // CSRF: calls from our client send a custom header (which needs CORS to send cross-site);
    // plain form posts must come from this site.
    if (!mode) {
      const origin = req.headers.get("origin");
      const fetchSite = req.headers.get("sec-fetch-site");
      const ok = origin && origin !== "null" ? sameSite(req, url, origin) : fetchSite === "same-origin";
      if (!ok) return new Response("Cross-site form posts aren't allowed.", { status: 403 });
    }
    // Where to go back to, worked out before the action runs: a bad Referer can't turn a
    // finished mutation into an error (and a retry into a second mutation).
    const ref = req.headers.get("referer");
    const back = (() => {
      if (!ref || !sameSite(req, url, ref)) return "/";
      const r = new URL(ref);
      return r.pathname + r.search;
    })();
    // The page the action was called from decides the locale.
    if (i18n) s.locale = splitLocale(ref && sameSite(req, url, ref) ? new URL(ref).pathname : "/").locale;
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
        if (typeof v === "string") {
          let parsed: unknown;
          try {
            parsed = JSON.parse(v);
          } catch {
            parsed = undefined;
          }
          if (!Array.isArray(parsed)) return jsonRes({ ok: false, error: "Bad arguments." }, 400);
          lead.push(...parsed);
        }
        fd.delete(field);
      }
      // React's progressive-enhancement fields for bound/hidden data.
      for (const k of [...fd.keys()]) if (k.startsWith("$ACTION")) fd.delete(k);
      args = [...lead, fd];
    }
    try {
      const value = await fn(...args);
      if (!mode) return new Response(null, { status: 303, headers: { Location: back } });
      return jsonRes({ ok: true, value: value ?? null, revalidated: s.revalidated || undefined });
    } catch (e) {
      if (e instanceof Response && e.headers.get("location")) {
        const loc = e.headers.get("location")!;
        return mode ? jsonRes({ ok: true, redirect: loc, revalidated: s.revalidated || undefined }) : new Response(null, { status: 303, headers: { Location: loc } });
      }
      const { ActionError } = await import("./server-api");
      const msg = e instanceof ActionError || dev ? (e as Error).message : "Something went wrong.";
      if (!(e instanceof ActionError)) console.error(`optz: action ${def.file}#${name}:`, e);
      // An ActionError is an expected outcome ("write something first"): 422, with the message.
      if (e instanceof ActionError) return mode ? jsonRes({ ok: false, error: msg }, 422) : new Response(msg, { status: 422, headers: { "Content-Type": "text/plain; charset=utf-8" } });
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
  async function route(ctx: MiddlewareContext, s: RequestStore, rewrites = 0): Promise<Response> {
    const { request: req, url } = ctx;
    const p = url.pathname;
    if (proxies.length) {
      const px = proxyFor(p);
      if (px) return proxy(req, url, px);
    }
    if (p.length > 1 && p.endsWith("/")) return new Response(null, { status: 308, headers: { Location: p.replace(/\/+$/, "") + url.search } });
    // The request store is complete before any branch runs: draft and locale are the same for
    // pages, their data, actions and API routes.
    s.draft = await isDraft(req);
    s.locale = splitLocale(p).locale;
    if (mcpOn && p === mcpPath) return inStore(s, async () => (await mcp()).handle(ctx));
    if (p === "/_optz/revalidate") return receiveRevalidation(req);
    if (p.startsWith("/_optz/action/")) return inStore(s, () => action(ctx, s));
    if (p.startsWith("/_optz/data/") && p.endsWith(".json")) return inStore(s, () => data(ctx, s));
    if (p.startsWith("/_optz/og/") && p.endsWith(".png")) return inStore(s, () => og(ctx));
    if (p === "/_optz/404" && prerender) return notFound(ctx, url.searchParams.get("locale") ?? undefined);
    if (p === "/_optz/image") return F.images && platform.images ? platform.images(req, url, files) : notFound(ctx);
    if (p === "/_optz/speculation.json" && files.has(p)) return send(files.get(p)!, req);
    if (p.startsWith("/_optz/")) return notFound(ctx);

    // Config redirects and rewrites, in route syntax.
    if (redirectRules.length) {
      const r = firstMatch(redirectRules, p);
      if (r) return new Response(null, { status: r.rule.permanent ? 308 : 307, headers: { Location: fillDestination(r.rule.destination, r.params) + (r.rule.destination.includes("?") ? "" : url.search) } });
    }
    if (rewriteRules.length && rewrites < 4) {
      const r = firstMatch(rewriteRules, p);
      if (r) {
        const dest = new URL(fillDestination(r.rule.destination, r.params), url);
        for (const [k, v] of url.searchParams) if (!dest.searchParams.has(k)) dest.searchParams.append(k, v);
        if (dest.origin !== url.origin) {
          // Another site: proxied like a proxy prefix (headers filtered, timeout, body cap).
          return proxy(new Request(dest, req), dest, { prefix: "", rule: { target: dest.origin, timeoutMs: 30_000 }, target: new URL(dest.origin) });
        }
        const next = new Request(dest, req);
        s.url = dest;
        return route({ request: next, url: dest, locals: ctx.locals }, s, rewrites + 1);
      }
    }

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

    // Pages only answer GET and HEAD; a redirect left by a page is no exception.
    const redir = req.method === "GET" || req.method === "HEAD" ? manifest.redirects[p] : undefined;
    if (redir) return new Response(null, { status: redir.status, headers: { Location: redir.location } });

    // Intercepting routes: in-app navigation from inside their folder. X-Optz-From says which
    // page the navigation started on; it's a request header, so the page it names must be one
    // this visitor may see (the middleware lets a GET for it through) before it's rendered.
    const claimed = hasIntercepts && req.headers.get("x-optz-swap") ? req.headers.get("x-optz-from") : null;
    const from = claimed && claimed.startsWith("/") && !claimed.startsWith("//") && (await allowedBy(claimed, req)) ? claimed.split(/[?#]/)[0] : null;
    if (from) {
      const fromInner = splitLocale(from).inner;
      const headers = { "Cache-Control": "no-store", Vary: "X-Optz-From" };
      for (const slot of manifest.slots ?? []) {
        for (const ir of slot.intercepts) {
          const params = matchSegments(ir.segments, inner);
          if (!params || !ir.scope || !inScope(ir.scope, fromInner)) continue;
          const under = matchRoute(manifest.routes, fromInner);
          if (!under || under.route.kind !== "page" || !under.route.layouts.includes(slot.layout)) continue;
          const route = under.route, uparams = under.params;
          return inStore(s, async () => {
            const { renderPage } = await render();
            const input = await renderInput(route, ctx, p, fromInner, uparams, locale, false, { slot, route: ir, params });
            return finish(await renderPage(input, assets(route), config), ctx, headers);
          });
        }
      }
      for (const ir of manifest.intercepts ?? []) {
        const params = matchSegments(ir.segments, inner);
        if (!params || !ir.scope || !inScope(ir.scope, fromInner)) continue;
        return inStore(s, async () => {
          const { renderPage } = await render();
          return finish(await renderPage(await renderInput(ir, ctx, p, inner, params, locale), assets(ir), config), ctx, headers);
        });
      }
    }

    const m = matchRoute(manifest.routes, inner);
    if (!m) {
      const f = files.get(p);
      if (f && !p.endsWith(".html")) return send(f, req);
      // API clients get JSON, not the HTML not-found page.
      if (inner === "/api" || inner.startsWith("/api/")) return jsonRes({ error: "Not found" }, 404);
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
        const allow = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].filter((k) => typeof mod[k] === "function" || (k === "HEAD" && typeof mod.GET === "function")).join(", ");
        return jsonRes({ error: `${req.method} isn't allowed here` }, 405, { Allow: allow });
      }
      const run = async () => {
        let res: Response;
        try {
          res = await handler({ ...ctx, params: m.params });
        } catch (e) {
          // A thrown Response (redirect(), readJson()'s 400/415, or your own) is the answer.
          if (e instanceof Response) return e;
          if (e instanceof Error && e.name === "NotFound") return jsonRes({ error: e.message || "Not found" }, 404);
          throw e;
        }
        const rc = mod.cache ?? config.cache.default;
        if (rc && !res.headers.has("cache-control") && res.status === 200) res.headers.set("Cache-Control", cacheControl(rc));
        return res;
      };
      return inStore(s, () => (req.method === "GET" || req.method === "HEAD" ? withCache(ctx, mod.cache, run) : run()));
    }
    if (req.method !== "GET" && req.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });

    const draft = s.draft;
    if (live && !draft && r.render === "static") {
      const f = files.get(htmlPath(p));
      if (f) {
        if (isStale(p, r)) regenerate(ctx, r, p, inner, m.params, locale);
        return send(f, req);
      }
      if (!r.dynamicParams) return notFound(ctx, locale);
      // Params paths() didn't list: render once, keep it like a built page (bounded by the
      // cache). Shared by everyone, so rendered from an anonymous request.
      const input = await renderInput(r, anonymous(url, p), p, inner, m.params, locale);
      const anon = input.ctx;
      return inStore(s, () =>
        withCache(ctx, { maxAge: r.revalidate ?? 31536000, staleWhileRevalidate: r.revalidate ? 31536000 : undefined, tags: r.tags }, () =>
          als.run(newStore({ request: anon.request!, url: anon.url, locals: anon.locals, locale, draft: false }), async () => {
            const { renderPage } = await render();
            return finish(await renderPage(input, assets(r), config), ctx);
          }),
        ),
      );
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
    return inStore(s, () => (rc ? withCache(ctx, rc, produce) : produce()));
  }

  const hasIntercepts = !!(manifest.intercepts?.length || manifest.slots?.some((x) => x.intercepts.length));

  /** Would the middleware let this visitor GET `path`? Runs the chain with this request's
   *  headers and a stand-in for the page (so nothing renders). */
  async function allowedBy(path: string, req: Request): Promise<boolean> {
    if (!middleware.length) return true;
    let u: URL;
    try {
      u = new URL(path, req.url);
    } catch {
      return false;
    }
    const headers = new Headers(req.headers);
    headers.delete("x-optz-swap");
    headers.delete("x-optz-from");
    const r = new Request(u, { headers });
    const ctx: MiddlewareContext = { request: r, url: u, locals: {} as Locals };
    const stub = (i: number): Promise<Response> =>
      i < middleware.length ? Promise.resolve(middleware[i](ctx, () => stub(i + 1))) : Promise.resolve(new Response(null, { status: 200 }));
    try {
      const res = await stub(0);
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  const run = (ctx: MiddlewareContext, s: RequestStore, i: number): Promise<Response> =>
    i < middleware.length ? Promise.resolve(middleware[i](ctx, () => run(ctx, s, i + 1))) : route(ctx, s);

  async function fetch(req: Request, plat?: RequestPlatform): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname;
    // Hashed assets: no middleware, straight from memory.
    if (p.startsWith("/assets/")) {
      const f = files.get(p);
      return f ? send(f, req) : new Response("Not found", { status: 404 });
    }
    // Proxy prefixes that skip middleware go straight out; the others are proxied by route().
    const px = proxies.length ? proxyFor(p) : undefined;
    if (px?.rule.bypassMiddleware) return proxy(req, url, px);
    const ctx: MiddlewareContext = { request: req, url, locals: {} as Locals };
    const t0 = F.requestLog ? performance.now() : 0;
    try {
      const res = await run(ctx, newStore({ request: req, url, locals: ctx.locals, draft: false, env: plat?.env, waitUntil: plat?.waitUntil }), 0);
      const nonce = streamed.has(ctx) ? res.headers.get(NONCE) : null;
      if (nonce) {
        res.headers.delete(NONCE);
        withNonce(res, nonce);
      }
      if (headerRules.length) {
        for (const r of headerRules) {
          if (!matchSegments(r.segments, p)) continue;
          for (const [k, v] of Object.entries(r.headers)) res.headers.set(k, v);
        }
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
