// Public types for route modules, middleware and config.
import type { ComponentType, ReactNode } from "react";

export type Params = Record<string, string>;

/** How a page is produced. */
export type RenderMode =
  /** Rendered once at build time (default). Pages with [params] need `paths()`. */
  | "static"
  /** Rendered on every request on the server; `loader` runs per request. */
  | "dynamic"
  /** One shell rendered at build time and served for every matching URL; the page loads its own
   *  data in the browser. Costs the server nothing per request. */
  | "client";

export interface LoaderContext {
  params: Params;
  url: URL;
  /** Only for dynamic pages (static pages are rendered at build time, without a request). */
  request?: Request;
  /** Values set by middleware (dynamic pages only). */
  locals: Record<string, unknown>;
}

export interface Head {
  title?: string;
  description?: string;
  meta?: Array<Record<string, string>>;
  links?: Array<Record<string, string>>;
}

export interface PageProps<D = unknown> {
  data: D;
  params: Params;
}

export interface PageModule<D = unknown> {
  default: ComponentType<PageProps<D>>;
  config?: { render?: RenderMode };
  loader?: (ctx: LoaderContext) => D | Promise<D>;
  paths?: () => Params[] | Promise<Params[]>;
  head?: (data: D, ctx: { params: Params }) => Head;
}

export interface LayoutModule {
  default: ComponentType<{ children: ReactNode; params: Params }>;
  head?: (ctx: { params: Params }) => Head;
}

export interface ErrorModule {
  default: ComponentType<{ error: Error; params: Params }>;
}

export interface MiddlewareContext {
  request: Request;
  url: URL;
  /** Per-request values for loaders and API routes. */
  locals: Record<string, unknown>;
}

export type Middleware = (ctx: MiddlewareContext, next: () => Promise<Response>) => Response | Promise<Response>;

export type ApiHandler = (ctx: MiddlewareContext & { params: Params }) => Response | Promise<Response>;

export interface Config {
  /** Port for `optz start` (the PORT env var wins). Default 3001. */
  port?: number;
  /** Host for `optz start` (the HOST env var wins). Default 127.0.0.1. */
  hostname?: string;
  /** Forward a path prefix to another server, e.g. { "/api": { target: "http://127.0.0.1:3000", strip: true } }.
   *  In production, put the same rule in nginx so that traffic never touches Bun. */
  proxy?: Record<string, { target: string; strip?: boolean }>;
  /** Extra <head> tags on every page: fonts, icons, etc. */
  head?: { links?: Array<Record<string, string>>; meta?: Array<Record<string, string>> };
  /** HTML lang attribute. Default "en". */
  lang?: string;
  /** Tailwind/CSS entry, relative to the app. Default "app/styles.css" if it exists. */
  css?: string;
}
