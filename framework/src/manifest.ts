// Shared by build and server; deliberately imports nothing heavy.
import type { ActionModule } from "./actions-runtime";
import type { Segment } from "./match";
import type { RenderMode } from "./types";

export interface ManifestRoute {
  pattern: string;
  segments: Segment[];
  file: string;
  kind: "page" | "api";
  render: RenderMode;
  hasLoader: boolean;
  layouts: string[];
  error?: string;
  loading?: string;
  og?: string;
  preload: string[];
  shell?: string;
  /** Static pages and prerendered API routes: regenerate after this many seconds. */
  revalidate?: number;
  /** Static pages: render unlisted params on demand. */
  dynamicParams?: boolean;
  tags?: string[];
  /** API routes: GET was run at build time. */
  prerendered?: boolean;
  /** Intercepting routes: where navigation must start. */
  scope?: Segment[];
}

export interface ManifestSlot {
  name: string;
  layout: string;
  routes: ManifestRoute[];
  intercepts: ManifestRoute[];
  default?: string;
}

export interface Manifest {
  version: 3;
  /** ms since epoch: when the static files were rendered (ISR ages count from here). */
  builtAt: number;
  mode: "islands" | "spa";
  entry: string;
  css: string[];
  routes: ManifestRoute[];
  /** Islands mode: island id -> chunk URL. */
  islands: Record<string, string>;
  notFound?: string;
  rootLayouts: string[];
  redirects: Record<string, { status: number; location: string }>;
  slots: ManifestSlot[];
  intercepts: ManifestRoute[];
  /** Server Actions: id -> module. */
  actions: Record<string, ActionModule>;
  /** Font files to preload on every page. */
  fonts: string[];
  /** Prerendered API responses: URL path -> static file, content type and application headers. */
  apiStatic: Record<string, { file: string; type: string; headers?: Record<string, string> }>;
  /** MCP tools, prompts and resources: files in app/mcp. */
  mcp?: string[];
}

export const MANIFEST_VERSION = 3;

/** Parses dist/manifest.json, refusing one written by another optz version. */
export function parseManifest(text: string): Manifest {
  const m = JSON.parse(text) as Manifest;
  if (m?.version !== MANIFEST_VERSION) throw new Error(`optz: dist/ was built by a different optz version (manifest ${m?.version ?? "?"}, expected ${MANIFEST_VERSION}). Run \`optz build\` again.`);
  return m;
}

export const outDirFor = (root: string, dev?: boolean) => `${root.replace(/\/$/, "")}/${dev ? ".optz/dev" : "dist"}`;

/** Where a page's HTML lives in dist/static. */
export const htmlPath = (pathname: string) => (pathname === "/" ? "/index.html" : `${pathname}/index.html`);
/** Where a page's Open Graph image is served. */
export const ogPath = (pathname: string) => `/_optz/og${pathname === "/" ? "/index" : pathname}.png`;
/** Where a prerendered API response lives in dist/static. */
// '$response' is reserved for bodies; encodeURIComponent escapes '$' in actual URL segments,
// so even a route literally named '$response' cannot collide with its parent's body file.
export const apiStaticPath = (pathname: string) => `/_optz/api${pathname.split("/").map(encodeURIComponent).join("/")}/$response`;
