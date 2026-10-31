// In-memory static files: body plus brotli and gzip copies and an ETag, served with a map
// lookup. Web-standard code only, so the same serving logic runs on Bun, Node, Deno and in
// edge workers.
import { selectEncoding } from "./encoding";

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

/** Keep application headers when freezing an API response, but rebuild its transport headers. */
export function prerenderHeaders(headers: Headers): Record<string, string> {
  if (headers.has("set-cookie") || /(?:^|[,\s])(?:private|no-store)(?:[,\s=]|$)/i.test(headers.get("cache-control") ?? "")) {
    throw new Error("Prerendered API responses must be public and must not set cookies");
  }
  const connection = new Set((headers.get("connection") ?? "").toLowerCase().split(",").map(h => h.trim()));
  const out: Record<string, string> = {};
  headers.forEach((value, name) => {
    if (!connection.has(name) && !/^(connection|keep-alive|proxy-authenticate|proxy-authorization|te|trailer|transfer-encoding|upgrade|content-type|content-encoding|content-length|etag|age|vary)$/i.test(name)) out[name] = value;
  });
  out.vary = [...new Set(["accept-encoding", ...(headers.get("vary") ?? "").toLowerCase().split(",").map(h => h.trim()).filter(Boolean)])].join(", ");
  return out;
}

/** Headers per encoding, built once per entry (Response copies them, so sharing is safe). */
function headsOf(e: StaticEntry) {
  let h = heads.get(e);
  if (!h) {
    const base: Record<string, string> = { "content-type": e.type, "cache-control": e.cache, etag: e.etag, vary: "Accept-Encoding" };
    for (const [name, value] of Object.entries(e.headers ?? {})) base[name.toLowerCase()] = value;
    h = { raw: base, br: { ...base, "content-encoding": "br" }, gzip: { ...base, "content-encoding": "gzip" } };
    heads.set(e, h);
  }
  return h;
}

export function send(e: StaticEntry, req: Request, status = 200, extra?: Record<string, string>): Response {
  const h = headsOf(e);
  const encoding = selectEncoding(req.headers.get("accept-encoding"), !!e.br, !!e.gz);
  if (!encoding) return new Response("No acceptable content encoding", { status: 406, headers: { Vary: "Accept-Encoding" } });
  if (status === 200 && req.headers.get("if-none-match") === e.etag) return new Response(null, { status: 304, headers: extra ? { ...h.raw, ...extra } : h.raw });
  let body = e.body;
  let head = h.raw;
  if (e.br && encoding === "br") {
    body = e.br;
    head = h.br;
  } else if (e.gz && encoding === "gzip") {
    body = e.gz;
    head = h.gzip;
  }
  return new Response(req.method === "HEAD" ? null : body as BodyInit, { status, headers: extra ? { ...head, ...extra } : head });
}
