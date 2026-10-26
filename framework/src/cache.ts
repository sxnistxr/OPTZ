// In-memory response cache for dynamic pages, their data and API GET routes.
//
// - fresh: served from memory (already compressed, with an ETag; 304 when the client has it)
// - stale but within staleWhileRevalidate: served from memory while ONE background request
//   refreshes it
// - miss: concurrent requests for the same key share one render (no stampede)
// Bounded by entry count and total bytes (least recently used goes first). Responses that set
// cookies, aren't 200, or say private/no-store are never stored.
import { brotliCompressSync, constants as zc } from "node:zlib";
import type { RouteCache } from "./types";

interface Entry {
  status: number;
  headers: [string, string][];
  body: Uint8Array;
  gz?: Uint8Array;
  br?: Uint8Array;
  etag: string;
  storedAt: number;
  rc: RouteCache;
  bytes: number;
}

export interface CacheStats {
  hits: number;
  stale: number;
  misses: number;
  entries: number;
  bytes: number;
}

export class ResponseCache {
  private map = new Map<string, Entry>();
  private inflight = new Map<string, Promise<Entry | Response>>();
  private bytes = 0;
  readonly stats: CacheStats = { hits: 0, stale: 0, misses: 0, entries: 0, bytes: 0 };

  constructor(
    private maxEntries: number,
    private maxBytes: number,
  ) {}

  static key(req: Request, url: URL, rc: RouteCache): string {
    let k = `${url.pathname}${url.search}`;
    for (const h of rc.vary ?? []) k += `\n${h}:${req.headers.get(h) ?? ""}`;
    return k;
  }

  /** Serves `key` from the cache, or produces, stores and serves it. */
  async handle(req: Request, key: string, rc: RouteCache, produce: () => Promise<Response>): Promise<Response> {
    const now = Date.now();
    const hit = this.map.get(key);
    if (hit) {
      const age = (now - hit.storedAt) / 1000;
      if (age < hit.rc.maxAge) {
        this.touch(key, hit);
        this.stats.hits++;
        return respond(hit, req, age);
      }
      if (age < hit.rc.maxAge + (hit.rc.staleWhileRevalidate ?? 0)) {
        this.touch(key, hit);
        this.stats.stale++;
        if (!this.inflight.has(key)) this.fill(key, rc, produce).catch(() => {});
        return respond(hit, req, age);
      }
    }
    this.stats.misses++;
    const r = await (this.inflight.get(key) ?? this.fill(key, rc, produce));
    return r instanceof Response ? r : respond(r, req, 0);
  }

  private fill(key: string, rc: RouteCache, produce: () => Promise<Response>): Promise<Entry | Response> {
    const p = (async () => {
      const res = await produce();
      const cc = res.headers.get("cache-control") ?? "";
      if (res.status !== 200 || res.headers.has("set-cookie") || /no-store|private/.test(cc)) return res;
      const body = new Uint8Array(await res.arrayBuffer());
      const headers: [string, string][] = [];
      res.headers.forEach((v, k) => {
        if (!/^(content-encoding|content-length|etag|cache-control|age|vary)$/i.test(k)) headers.push([k, v]);
      });
      const compressible = /text|json|javascript|xml|svg/.test(res.headers.get("content-type") ?? "") && body.length > 512;
      const e: Entry = {
        status: 200,
        headers,
        body,
        // Compressed once per entry, not per request. Brotli at quality 5: fast and small.
        gz: compressible ? Bun.gzipSync(body, { level: 6 }) : undefined,
        br: compressible ? brotliCompressSync(body, { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } }) : undefined,
        etag: `"${Bun.hash(body).toString(36)}"`,
        storedAt: Date.now(),
        rc,
        bytes: 0,
      };
      e.bytes = body.length + (e.gz?.length ?? 0) + (e.br?.length ?? 0) + key.length;
      if (e.bytes < this.maxBytes / 4) this.store(key, e);
      return e;
    })();
    this.inflight.set(key, p);
    p.finally(() => this.inflight.delete(key)).catch(() => {});
    return p;
  }

  private touch(key: string, e: Entry) {
    this.map.delete(key);
    this.map.set(key, e);
  }

  private store(key: string, e: Entry) {
    const old = this.map.get(key);
    if (old) this.bytes -= old.bytes;
    this.map.delete(key);
    this.map.set(key, e);
    this.bytes += e.bytes;
    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      const [k, v] = this.map.entries().next().value as [string, Entry];
      this.map.delete(k);
      this.bytes -= v.bytes;
    }
    this.stats.entries = this.map.size;
    this.stats.bytes = this.bytes;
  }

  clear() {
    this.map.clear();
    this.bytes = 0;
  }
}

export function cacheControl(rc: RouteCache) {
  return `public, max-age=0, s-maxage=${rc.maxAge}${rc.staleWhileRevalidate ? `, stale-while-revalidate=${rc.staleWhileRevalidate}` : ""}`;
}

function respond(e: Entry, req: Request, age: number): Response {
  const h = new Headers(e.headers);
  h.set("ETag", e.etag);
  h.set("Cache-Control", cacheControl(e.rc));
  h.set("Age", String(Math.floor(age)));
  h.set("Vary", ["Accept-Encoding", ...(e.rc.vary ?? [])].join(", "));
  if (req.headers.get("if-none-match") === e.etag) return new Response(null, { status: 304, headers: h });
  const ae = req.headers.get("accept-encoding") ?? "";
  let body = e.body;
  if (e.br && ae.includes("br")) {
    body = e.br;
    h.set("Content-Encoding", "br");
  } else if (e.gz && ae.includes("gzip")) {
    body = e.gz;
    h.set("Content-Encoding", "gzip");
  }
  return new Response(body, { status: e.status, headers: h });
}
