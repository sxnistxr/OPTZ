// Public types for route modules, API routes, middleware and config.
import type { ComponentType, ReactNode } from "react";

export type Params = Record<string, string>;

// ---- typed routes --------------------------------------------------------------------------
// `optz build`/`dev`/`check` generate .optz/types.d.ts, which fills these registries from your
// files. Until then they're empty and everything falls back to plain strings.

/** Page patterns -> their params, e.g. { "/blog/[slug]": { slug: string } }. */
// biome-ignore lint: augmented by generated types
export interface RouteRegistry {}
/** API patterns -> their modules, e.g. { "/api/stats": typeof import("app/api/stats") }. */
// biome-ignore lint: augmented by generated types
export interface ApiRegistry {}

type Part<S extends string> = S extends `[[...${string}]]` ? "" | `/${string}` : S extends `[...${string}]` ? `/${string}` : S extends `[${string}]` ? `/${string}` : `/${S}`;
type Fill<P extends string> = P extends `/${infer A}/${infer B}` ? `${Part<A>}${Fill<`/${B}`>}` : P extends `/${infer A}` ? (A extends "" ? "/" : Part<A>) : P;
type Root<T extends string> = T extends "" ? "/" : T;
type Suffix = "" | `?${string}` | `#${string}`;

/** Every URL your pages answer, as template literal types ("/blog/${string}"). */
export type AppHref = keyof RouteRegistry extends never ? string : `${Root<Fill<keyof RouteRegistry & string>>}${Suffix}`;
/** What `<Link href>` accepts: an app URL, or anything clearly external or local-only. */
export type Href = AppHref | `http://${string}` | `https://${string}` | `mailto:${string}` | `tel:${string}` | `#${string}`;

export type ParamsOf<P> = P extends keyof RouteRegistry ? RouteRegistry[P] : Params;

/** How a page is produced. */
export type RenderMode =
  /** Rendered once at build time (default). Pages with [params] need `paths()`. */
  | "static"
  /** Rendered on every request on the server; `loader` runs per request. */
  | "dynamic"
  /** One shell rendered at build time and served for every matching URL; the page's islands
   *  load their own data in the browser. Costs the server nothing per request. */
  | "client";

export interface LoaderContext<P = Params> {
  params: P;
  url: URL;
  /** The current locale when `i18n` is configured. */
  locale?: string;
  /** Draft mode is on for this request (see `draftMode()` in optz/server). */
  draft?: boolean;
  /** Only for dynamic pages (static pages are rendered at build time, without a request). */
  request?: Request;
  /** Values set by middleware (dynamic pages only). */
  locals: Locals;
}

/** Per-request values set by middleware. Augment it for types:
 *  declare module "optz" { interface Locals { user?: User } } */
// biome-ignore lint: open for augmentation
export interface Locals {
  [key: string]: unknown;
}

export interface OpenGraphImage {
  url: string;
  type?: string;
  width?: number;
  height?: number;
  alt?: string;
}

/** Everything that goes in <head>. Relative URLs in canonical, openGraph and twitter become
 *  absolute with `site.url` from the config. */
export interface Head {
  title?: string;
  description?: string;
  canonical?: string;
  /** "noindex, nofollow", or { index: false } */
  robots?: string | { index?: boolean; follow?: boolean };
  keywords?: string[];
  themeColor?: string;
  openGraph?: {
    title?: string;
    description?: string;
    type?: "website" | "article" | "profile";
    url?: string;
    siteName?: string;
    locale?: string;
    images?: Array<string | OpenGraphImage>;
    publishedTime?: string;
    authors?: string[];
  };
  twitter?: {
    card?: "summary" | "summary_large_image";
    site?: string;
    creator?: string;
    title?: string;
    description?: string;
    images?: string[];
    imageAlt?: string;
  };
  /** hreflang alternates (added automatically with i18n) and feeds, e.g. { types: { "application/rss+xml": "/feed.xml" } } */
  alternates?: { languages?: Record<string, string>; types?: Record<string, string> };
  meta?: Array<Record<string, string>>;
  links?: Array<Record<string, string>>;
}

/** Props of a page component. `PageProps<Data, "/blog/[slug]">` types the params too. */
export interface PageProps<D = unknown, P extends string = string> {
  data: D;
  params: P extends keyof RouteRegistry ? RouteRegistry[P] : Params;
  /** The current locale when `i18n` is configured. */
  locale?: string;
}

/** Caching for a dynamic page or an API GET route (in memory, and `s-maxage` for nginx/CDNs). */
export interface RouteCache {
  /** Seconds a cached response is fresh. */
  maxAge: number;
  /** Seconds a stale response may still be served while one request refreshes it. */
  staleWhileRevalidate?: number;
  /** Request headers that change the response (each value gets its own entry). */
  vary?: string[];
  /** Names for `revalidateTag()`: dropping a tag drops every cached response that has it. */
  tags?: string[];
}

export interface PageModule<D = unknown> {
  default: ComponentType<PageProps<D>>;
  config?: { render?: RenderMode };
  loader?: (ctx: LoaderContext) => D | Promise<D>;
  /** Static pages with params: which ones to build. Gets the locale when i18n is on. */
  paths?: (ctx: { locale?: string }) => Params[] | Promise<Params[]>;
  head?: (data: D, ctx: { params: Params; locale?: string }) => Head;
  /** Dynamic pages: the response cache. */
  cache?: RouteCache;
  /** Static pages: rebuild in the background at most this often, in seconds (incremental
   *  static regeneration). `revalidatePath()` / `revalidateTag()` rebuild sooner. */
  revalidate?: number;
  /** Static pages with params: render params `paths()` didn't list on first request, then
   *  keep them. Default false (404). */
  dynamicParams?: boolean;
  /** Static pages: names for `revalidateTag()`. */
  tags?: string[];
}

export interface LayoutModule {
  /** Gets `children`, `params` and one prop per parallel route slot (`@name` folders). */
  default: ComponentType<{ children: ReactNode; params: Params; [slot: string]: ReactNode | Params }>;
  head?: (ctx: { params: Params; locale?: string }) => Head;
}

export interface ErrorModule {
  default: ComponentType<{ error: Error; params: Params }>;
}

export interface MiddlewareContext {
  request: Request;
  url: URL;
  /** Per-request values for loaders and API routes. */
  locals: Locals;
}

export type Middleware = (ctx: MiddlewareContext, next: () => Promise<Response>) => Response | Promise<Response>;

/** A Response that remembers the type of its JSON body, for the typed API client. */
export type TypedResponse<T> = Response & { readonly __json?: T };

/** "/api/posts/[id]/[...rest]" -> { id: string; rest: string } (optional catch-alls optional). */
export type PatternParams<P extends string> = P extends `${string}[${infer Rest}`
  ? Rest extends `[...${infer N}]]${infer R}`
    ? { [K in N]?: string } & PatternParams<R>
    : Rest extends `...${infer N}]${infer R}`
      ? { [K in N]: string } & PatternParams<R>
      : Rest extends `${infer N}]${infer R}`
        ? { [K in N]: string } & PatternParams<R>
        : unknown
  : unknown;

/** What an API route gets. Type the params with an object (`ApiContext<{ id: string }>`) or the
 *  route's pattern (`ApiContext<"/api/posts/[id]">`). */
export interface ApiContext<P = Params> extends MiddlewareContext {
  params: P extends string ? PatternParams<P> & Params : P;
}
export type ApiHandler<T = unknown, P = Params> = (ctx: ApiContext<P>) => TypedResponse<T> | Promise<TypedResponse<T>>;

/** API routes can be built ahead of time: `export const prerender = true` calls GET at build
 *  time (once per `paths()` entry) and serves the result from memory. */
export interface ApiModule {
  prerender?: boolean;
  paths?: () => Params[] | Promise<Params[]>;
  revalidate?: number;
  tags?: string[];
  cache?: RouteCache;
}

/** Islands: when they hydrate. */
export type Hydrate = "load" | "idle" | "visible";

// ---- config -------------------------------------------------------------------------------

export interface Config {
  /** Port for `optz start` (the PORT env var wins). Default 3001. */
  port?: number;
  /** Host for `optz start` (the HOST env var wins). Default 127.0.0.1. */
  hostname?: string;
  /** HTML lang attribute. Default "en". */
  lang?: string;
  /** Tailwind/CSS entry, relative to the project. Default "app/styles.css" if it exists. */
  css?: string;
  /** Extra <head> tags on every page: fonts, icons, etc. */
  head?: { links?: Array<Record<string, string>>; meta?: Array<Record<string, string>> };
  /** The site's public URL, e.g. "https://example.com". Makes canonical, Open Graph, sitemap
   *  and hreflang URLs absolute. */
  site?: { url?: string };
  /** Locale-prefixed routing: /fr/blog/x renders app/routes/blog/[slug].tsx with locale "fr". */
  i18n?: {
    locales: string[];
    defaultLocale: string;
    /** Prefix the default locale too (/en/...). Default false. */
    prefixDefault?: boolean;
    /** Redirect "/" by Accept-Language (and the optz-locale cookie). Default true. */
    detect?: boolean;
  };
  /** <Image> and /_optz/image. */
  images?: {
    /** Widths the optimizer will produce (others are rounded up). Default [384, 640, 828, 1080, 1200, 1920, 2048]. */
    sizes?: number[];
    /** Remote hosts images may come from, e.g. ["images.example.com"]. Default none (local only). */
    remoteHosts?: string[];
    /** Output formats in order of preference, picked by the browser's Accept header. Default ["avif", "webp"]. */
    formats?: Array<"avif" | "webp">;
    /** Default quality, 1-100. Default 75. */
    quality?: number;
    /** Max optimized images kept on disk, in MB. Default 256. */
    cacheMB?: number;
    /** Where optimized images are kept on disk (relative to the project or absolute). Default
     *  the OPTZ_IMAGE_CACHE_DIR env var, else .optz/cache/images. */
    cacheDir?: string;
    /** Complete image jobs at once (downloads and encodes), clamped to 1–4. At most 8 queued requests; overload is 503. Default cores minus one (1 to 4). */
    concurrency?: number;
  };
  /** Self-hosted web fonts: Google Fonts CSS URLs downloaded at build time and served from
   *  /assets, with size-matched fallbacks so text doesn't shift when they load. */
  fonts?: Array<{
    /** A fonts.googleapis.com/css2 URL. */
    google: string;
    /** Preload these subsets' files. Default ["latin"]. */
    preload?: string[];
    /** Local font the fallback face is based on. Default "Arial" (or "Times New Roman" for serif families). */
    fallback?: string;
  }>;
  /** Draft mode: a signed cookie that makes static pages render per request (for previews). */
  draft?: {
    /** Secret that signs the cookie. Default the OPTZ_DRAFT_SECRET env var, else random per
     *  process (which only works with one server process). */
    secret?: string;
    /** Seconds a draft cookie stays valid. Default 86400 (a day). */
    maxAge?: number;
  };
  /** Forward a path prefix to another server, e.g. { "/api/social": { target: "http://127.0.0.1:3000", strip: true } }.
   *  The target's own path is kept (target "http://x/v1" + "/a" -> "http://x/v1/a"). Requests go
   *  through app/middleware.ts first unless `bypassMiddleware`; with it, `optz nginx` sends the
   *  prefix straight to the target so that traffic never touches Bun. */
  proxy?: Record<string, ProxyRule>;

  /** What the browser gets. */
  client?: {
    /** "islands" (default): pages are HTML; only `*.island.tsx` components ship JS and hydrate.
     *  "spa": the whole page hydrates and the React router takes over navigation. */
    mode?: "islands" | "spa";
    /** islands mode: swap page HTML on link clicks instead of full loads (~2 KB). Default true. */
    navigation?: boolean;
    /** Fetch pages/data on link hover, focus or touch. Default true. */
    prefetch?: boolean;
    /** islands mode: the library islands hydrate with. "preact" ships ~4 KB instead of ~60 KB;
     *  your components still use the React API through preact/compat. Default "react". */
    runtime?: "react" | "preact";
    /** Let Chromium browsers prerender the next page while a link is hovered or pressed (the
     *  Speculation Rules API, sent as a response header, so a strict CSP is fine). Where it's
     *  supported, links do real navigations into the prerendered page (instant, with a
     *  cross-document view transition); elsewhere HTML-swap navigation is used. Default true. */
    speculation?: boolean;
  };

  /** Turn off what you don't use; each one saves memory or work per request. */
  features?: {
    /** app/middleware.ts. Default true. */
    middleware?: boolean;
    /** Pages with render "dynamic". Off: they're a build error, and react-dom/server is never
     *  loaded by the running server. Default true. */
    dynamic?: boolean;
    /** API routes in app/api. Default true. */
    api?: boolean;
    /** The in-memory response cache. Default true. */
    cache?: boolean;
    /** Compress dynamic responses on the fly (static files are always pre-compressed). Default true. */
    dynamicCompression?: boolean;
    /** ETag / 304 Not Modified for dynamic responses too. Default true. */
    etag?: boolean;
    /** Log each request (costs a little per request). Default false. */
    requestLog?: boolean;
    /** Stream dynamic pages (Suspense, async components, _loading.tsx). Off: they're sent whole. Default true. */
    streaming?: boolean;
    /** Server Actions ("use server" modules). Default true. */
    actions?: boolean;
    /** The /_optz/image optimizer. Default true. */
    images?: boolean;
    /** The MCP endpoint (see `mcp`). Default true: on when app/mcp has files or `mcp` is set. */
    mcp?: boolean;
  };

  /** The app as a Model Context Protocol server, so AI clients (Claude, ChatGPT, Codex, Cursor,
   *  VS Code, ...) can use it. Files in app/mcp are its tools, prompts and resources (see
   *  "optz/mcp"). Setting this turns the endpoint on even without app/mcp (pages only). */
  mcp?: {
    /** Where it's served. Default "/mcp". */
    path?: string;
    /** Server name clients show. Default site.url's host name. */
    name?: string;
    title?: string;
    version?: string;
    /** Told to the model when it connects: what the server is for and how to use its tools. */
    instructions?: string;
    /** Pre-rendered pages as resources, with `search_pages` and `read_page` tools. Default true. */
    pages?: boolean;
    /** Browser origins allowed to call it (site.url's origin always is). Clients that aren't
     *  browsers send no Origin and are always allowed; use middleware to authenticate them. */
    allowedOrigins?: string[];
  };

  /** /llms.txt (an index of the site for language models, llmstxt.org) and /llms-full.txt (every
   *  page as text), written at build time from the pre-rendered pages. app/llms.ts can return the
   *  llms.txt text instead. `false` turns both off. Default on. */
  llms?:
    | false
    | {
        /** Default the home page's title. */
        title?: string;
        /** Default the home page's description. */
        description?: string;
        /** Also write /llms-full.txt. Default true. */
        full?: boolean;
        /** Leave out pages whose path starts with one of these. */
        exclude?: string[];
      };

  /** Redirects for URLs no page answers anymore, in route syntax: { source: "/old/[slug]",
   *  destination: "/blog/[slug]", permanent: true }. Checked before pages; 308 if permanent,
   *  else 307 (the method is kept). */
  redirects?: Array<{ source: string; destination: string; permanent?: boolean }>;
  /** Serve another path's response (or proxy a URL) under this one, without a redirect:
   *  { source: "/docs/[...rest]", destination: "/guide/[...rest]" }. */
  rewrites?: Array<{ source: string; destination: string }>;
  /** Response headers by path: { source: "/api/[...rest]", headers: { "Access-Control-Allow-Origin": "*" } }. */
  headers?: Array<{ source: string; headers: Record<string, string> }>;

  /** Beyond this process: revalidatePath()/revalidateTag() reach the other instances of the
   *  app and the CDN in front of it. */
  revalidation?: {
    /** Base URLs of the other instances (e.g. ["http://10.0.0.2:3001"]). Each change is POSTed
     *  to their /_optz/revalidate, signed with `secret`, so every instance drops the same pages. */
    peers?: string[];
    /** Signs and checks those requests. Default the OPTZ_REVALIDATE_SECRET env var. Required
     *  for peers (and for accepting /_optz/revalidate at all). */
    secret?: string;
    /** Called with what changed, once per revalidatePath/revalidateTag on the instance where it
     *  happened: purge a CDN here (see cloudflarePurge() in optz/cdn). */
    purge?: (change: RevalidationChange) => unknown;
  };

  cache?: {
    /** Max cached responses. Default 500. */
    maxEntries?: number;
    /** Max total bytes of cached bodies. Default 32 MB. */
    maxBytes?: number;
    /** Applied to dynamic pages and API GETs that don't set `cache`. Default none. */
    default?: RouteCache;
  };

  server?: {
    /** Seconds before an idle connection is closed. Default 30 (Bun's max is 255). */
    idleTimeout?: number;
    /** Largest request body accepted, in bytes. Default 1 MB. */
    maxRequestBodySize?: number;
    /** Behind a reverse proxy you control that sets X-Forwarded-Host/-Proto: trust them for
     *  the public origin (CSRF checks, absolute URLs). Off: they're ignored, since any client can
     *  send them. Default false. */
    trustProxy?: boolean;
    /** Let a CDN (Cloudflare, ...) cache built HTML pages for this many seconds (`s-maxage`, with
     *  stale-while-revalidate). Browsers still revalidate every time. Pages then carry Cache-Tag and
     *  Surrogate-Key headers ("optz-path:<path>" and their tags); purge the CDN on deploy, and on
     *  revalidation with `revalidation.purge`. Default 0 (off). */
    cdnMaxAge?: number;
  };
}

export interface ProxyRule {
  target: string;
  /** Drop the prefix: "/api/social/feed" -> target + "/feed". */
  strip?: boolean;
  /** Skip app/middleware.ts (and let `optz nginx` route it without Bun). Default false. */
  bypassMiddleware?: boolean;
  /** Give up on the target after this many milliseconds (504). Default 30000. */
  timeoutMs?: number;
  /** Largest request body forwarded, in bytes. Default server.maxRequestBodySize. */
  maxBodySize?: number;
  /** nginx micro-cache for GETs, in seconds (0 = off). */
  cacheSeconds?: number;
}

/** What revalidatePath()/revalidateTag() changed. Paths are absolute URL paths; `prefix`
 *  marks a layout revalidation (everything under the path). */
export interface RevalidationChange {
  paths: Array<{ path: string; prefix: boolean }>;
  tags: string[];
}

/** Config with every default filled in. */
export interface ResolvedConfig extends Config {
  lang: string;
  port: number;
  hostname: string;
  images: NonNullable<Config["images"]> & { sizes: number[]; formats: Array<"avif" | "webp">; quality: number; cacheMB: number };
  client: Required<NonNullable<Config["client"]>>;
  features: Required<NonNullable<Config["features"]>>;
  cache: { maxEntries: number; maxBytes: number; default?: RouteCache };
  server: Required<NonNullable<Config["server"]>>;
}

export function resolveConfig(c: Config = {}): ResolvedConfig {
  return {
    ...c,
    lang: c.lang ?? "en",
    port: c.port ?? 3001,
    hostname: c.hostname ?? "127.0.0.1",
    images: { sizes: [384, 640, 828, 1080, 1200, 1920, 2048], formats: ["avif", "webp"], quality: 75, cacheMB: 256, ...c.images },
    client: { mode: "islands", navigation: true, prefetch: true, runtime: "react", speculation: true, ...c.client },
    features: { middleware: true, dynamic: true, api: true, cache: true, dynamicCompression: true, etag: true, requestLog: false, streaming: true, actions: true, images: true, mcp: true, ...c.features },
    cache: { maxEntries: 500, maxBytes: 32 << 20, ...c.cache },
    server: { idleTimeout: 30, maxRequestBodySize: 1 << 20, cdnMaxAge: 0, trustProxy: false, ...c.server },
  };
}
