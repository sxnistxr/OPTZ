// In-memory response cache for dynamic pages, their data and API GET routes.
//
// - fresh: served from memory (already compressed, with an ETag; 304 when the client has it)
// - stale but within staleWhileRevalidate: served from memory while ONE background request
//   refreshes it
// - miss: identical anonymous requests share public work; private results are recomputed
//   independently for every caller, including callers already waiting on that work.
// Bounded by entry count and total bytes (least recently used goes first). Responses that set
// cookies, aren't 200, say private/no-store, or vary on Cookie, Authorization or * are never
// stored. Other headers a response varies on become part of its key, like `rc.vary`.
// Invalidation wins over renders already running: what they produce isn't stored.
import { fnv } from "./static";
import type { RouteCache } from "./types";

export interface Compressors {
  hash?: (b: Uint8Array) => string;
  gzip?: (b: Uint8Array) => Uint8Array;
  brotli?: (b: Uint8Array) => Uint8Array;
}

interface Entry {
  status: number;
  headers: [string, string][];
  body: Uint8Array;
  gz?: Uint8Array;
  br?: Uint8Array;
  etag: string;
  storedAt: number;
  rc: RouteCache;
  /** Request headers the response varies on: rc.vary plus the response's own Vary. */
  vary: string[];
  bytes: number;
}

interface Inflight {
  promise: Promise<Entry | Response>;
  rc: RouteCache;

}

/** Request headers whose responses must never be shared between users. */
const PERSONAL = /^(cookie|authorization|\*)$/i;

export interface CacheStats {
  hits: number;
  stale: number;
  misses: number;
  entries: number;
  bytes: number;
}

export class ResponseCache {
  private map = new Map<string, Entry>();
  private inflight = new Map<string, Inflight>();
  /** Bumped by invalidate(): renders that started earlier don't store their result. */
  private generation = 0;
  private bytes = 0;
  readonly stats: CacheStats = { hits: 0, stale: 0, misses: 0, entries: 0, bytes: 0 };

  constructor(
    private maxEntries: number,
    private maxBytes: number,
    private z: Compressors = {},
  ) {}

  /** Drops every entry `drop` matches (revalidatePath / revalidateTag). */
  invalidate(drop: (key: string, rc: RouteCache) => boolean) {
    this.generation++;
    for (const [k, e] of this.map) {
      if (!drop(k, e.rc)) continue;
      this.map.delete(k);
      this.bytes -= e.bytes;
    }
    // New requests start a fresh render instead of joining one that began before.
    for (const [k, f] of this.inflight) if (drop(k, f.rc)) this.inflight.delete(k);
    this.stats.entries = this.map.size;
    this.stats.bytes = this.bytes;
  }

  static key(req: Request, url: URL, rc: RouteCache): string {
    let k = `${url.pathname}${url.search}`;
    for (const h of rc.vary ?? []) k += `\n${h}:${req.headers.get(h) ?? ""}`;
    return k;
  }

  /** Serves `key` from the cache, or produces, stores and serves it. */
  async handle(req: Request, key: string, rc: RouteCache, produce: () => Promise<Response>): Promise<Response> {
    // Never serve or coalesce authenticated work through the shared response cache.
    if (req.headers.has("cookie") || req.headers.has("authorization")) {
      return privateResponse(await produce());
    }
    // Raw Request header reads are just as significant as headers()/cookies() reads.
    // Include all non-transport inputs even before a response teaches us its Vary fields.
    key += "\nrequest:" + JSON.stringify([req.method, req.url, [...req.headers].filter(([h]) => !["accept-encoding", "if-none-match"].includes(h))]);
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
        if (!this.inflight.has(key)) this.fill(req, key, rc, produce).promise.catch(() => {});
        return respond(hit, req, age);
      }
    }
    this.stats.misses++;
    const running = this.inflight.get(key);
    if (running) {
      const r = await running.promise;
      return r instanceof Response ? produce() : respond(r, req, 0);
    }
    const r = await this.fill(req, key, rc, produce).promise;
    return r instanceof Response ? r : respond(r, req, 0);
  }

  private fill(req: Request, key: string, rc: RouteCache, produce: () => Promise<Response>): Inflight {
    const gen = this.generation;
    const f: Inflight = { rc, promise: null as never };
    f.promise = (async () => {
      let res: Response;
      try {
        res = await produce();
      } finally {
        // From here on, new requests start their own render.
        if (this.inflight.get(key) === f) this.inflight.delete(key);
      }
      const cc = res.headers.get("cache-control") ?? "";
      const vary = (res.headers.get("vary") ?? "")
        .split(",")
        .map((v) => v.trim().toLowerCase())
        .filter((v) => v && v !== "accept-encoding");
      if (res.status !== 200 || res.headers.has("set-cookie") || /no-store|private/i.test(cc) || vary.some((v) => PERSONAL.test(v))) {
        // Waiters must run their own producer: even a no-store response may set a session.
        return res;
      }
      const configured = (rc.vary ?? []).map((v) => v.toLowerCase());
      const storeKey = key;
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
        // Compressed once per entry, not per request.
        gz: compressible ? this.z.gzip?.(body) : undefined,
        br: compressible ? this.z.brotli?.(body) : undefined,
        etag: `"${(this.z.hash ?? fnv)(body)}"`,
        storedAt: Date.now(),
        rc,
        vary: [...new Set([...configured, ...vary])],
        bytes: 0,
      };
      e.bytes = body.length + (e.gz?.length ?? 0) + (e.br?.length ?? 0) + storeKey.length;
      // Stored only if nothing was invalidated while it rendered, and only under a key that
      // includes every header it varies on.
      if (gen === this.generation && e.bytes < this.maxBytes / 4) this.store(storeKey, e);
      return e;
    })();
    this.inflight.set(key, f);
    f.promise.catch(() => {});
    return f;
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
    this.generation++;
    this.inflight.clear();
    this.map.clear();
    this.bytes = 0;
  }
}

export function cacheControl(rc: RouteCache) {
  // Responses that differ per user may be cached here (keyed by that header) but never by a CDN.
  if ((rc.vary ?? []).some((v) => PERSONAL.test(v))) return "private, max-age=0";
  return `public, max-age=0, s-maxage=${rc.maxAge}${rc.staleWhileRevalidate ? `, stale-while-revalidate=${rc.staleWhileRevalidate}` : ""}`;
}

function respond(e: Entry, req: Request, age: number): Response {
  const h = new Headers(e.headers);
  h.set("ETag", e.etag);
  h.set("Cache-Control", cacheControl(e.rc));
  h.set("Age", String(Math.floor(age)));
  h.set("Vary", ["Accept-Encoding", ...e.vary].join(", "));
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
  return new Response(body as BodyInit, { status: e.status, headers: h });
}

/** Fetch responses can have immutable headers; never mutate them to enforce privacy. */
export function privateResponse(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "private, no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
