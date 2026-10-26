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

export interface ApiContext<P = Params> extends MiddlewareContext {
  params: P;
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
    /** Secret that signs the cookie. Default the OPTZ_DRAFT_SECRET env var, else random per process. */
    secret?: string;
  };
  /** Forward a path prefix to another server, e.g. { "/api/social": { target: "http://127.0.0.1:3000", strip: true } }.
   *  `optz nginx` turns these into nginx locations so production traffic never touches Bun. */
  proxy?: Record<string, { target: string; strip?: boolean; /** nginx micro-cache for GETs, in seconds (0 = off). */ cacheSeconds?: number }>;

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
    /** Let a CDN (Cloudflare, ...) cache built HTML pages for this many seconds (`s-maxage`, with
     *  stale-while-revalidate). Browsers still revalidate every time. Purge the CDN on deploy.
     *  Default 0 (off). */
    cdnMaxAge?: number;
  };
}

/** Config with every default filled in. */
export interface ResolvedConfig extends Config {
  client: Required<NonNullable<Config["client"]>>;
  features: Required<NonNullable<Config["features"]>>;
  cache: { maxEntries: number; maxBytes: number; default?: RouteCache };
  server: Required<NonNullable<Config["server"]>>;
}

export function resolveConfig(c: Config = {}): ResolvedConfig {
  return {
    ...c,
    client: { mode: "islands", navigation: true, prefetch: true, runtime: "react", speculation: true, ...c.client },
    features: { middleware: true, dynamic: true, api: true, cache: true, dynamicCompression: true, etag: true, requestLog: false, streaming: true, actions: true, images: true, ...c.features },
    cache: { maxEntries: 500, maxBytes: 32 << 20, ...c.cache },
    server: { idleTimeout: 30, maxRequestBodySize: 1 << 20, cdnMaxAge: 0, ...c.server },
  };
}
