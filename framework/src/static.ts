// In-memory static files: body plus brotli and gzip copies and an ETag, served with a map
// lookup. Web-standard code only, so the same serving logic runs on Bun, Node, Deno and in
// edge workers.

export interface StaticEntry {
  body: Uint8Array;
  br?: Uint8Array;
  gz?: Uint8Array;
  type: string;
  etag: string;
  cache: string;
  /** Extra response headers (e.g. Speculation-Rules on HTML pages). */
  headers?: Record<string, string>;
}

export const TYPES: Record<string, string> = {
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

export const typeOf = (path: string) =>
  path.endsWith("/_optz/speculation.json") ? "application/speculationrules+json" : (TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream");

export const cacheFor = (url: string) =>
  url.startsWith("/assets/") ? "public, max-age=31536000, immutable" : /\.(html|json)$/.test(url) || url.startsWith("/_optz/api/") ? "no-cache" : "public, max-age=3600";

/** 64-bit FNV-1a, base36: a fast, portable ETag hash. */
export function fnv(data: Uint8Array | string): string {
  const b = typeof data === "string" ? new TextEncoder().encode(data) : data;
  let h1 = 0x811c9dc5,
    h2 = 0x050c5d1f;
  for (let i = 0; i < b.length; i++) {
    h1 = Math.imul(h1 ^ b[i], 0x01000193);
    h2 = Math.imul(h2 ^ b[i], 0x01000193) ^ (h1 >>> 7);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

const heads = new WeakMap<StaticEntry, Record<string, Record<string, string>>>();

/** Headers per encoding, built once per entry (Response copies them, so sharing is safe). */
function headsOf(e: StaticEntry) {
  let h = heads.get(e);
  if (!h) {
    const base = { "Content-Type": e.type, "Cache-Control": e.cache, ETag: e.etag, Vary: "Accept-Encoding", ...e.headers };
    h = { raw: base, br: { ...base, "Content-Encoding": "br" }, gzip: { ...base, "Content-Encoding": "gzip" } };
    heads.set(e, h);
  }
  return h;
}

export function send(e: StaticEntry, req: Request, status = 200, extra?: Record<string, string>): Response {
  const h = headsOf(e);
  if (status === 200 && req.headers.get("if-none-match") === e.etag) return new Response(null, { status: 304, headers: extra ? { ...h.raw, ...extra } : h.raw });
  const ae = req.headers.get("accept-encoding") ?? "";
  let body = e.body;
  let head = h.raw;
  if (e.br && ae.includes("br")) {
    body = e.br;
    head = h.br;
  } else if (e.gz && ae.includes("gzip")) {
    body = e.gz;
    head = h.gzip;
  }
  return new Response(body as BodyInit, { status, headers: extra ? { ...head, ...extra } : head });
}
