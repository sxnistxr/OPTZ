import type { Middleware } from "./types";
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
/** Browser CSRF defense for cookie-authenticated mutations. Use the configured public origin. */
export function assertSameOrigin(request: Request, origin: string): void {
  if (SAFE.has(request.method)) return;
  let actual: string | undefined;
  try { actual = new URL(request.headers.get("origin") ?? "").origin; } catch {}
  if (actual !== new URL(origin).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new Response("Cross-origin mutation denied", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
}
export const csrf = (origin: string): Middleware => async (ctx, next) => {
  try { assertSameOrigin(ctx.request, origin); } catch (error) { if (error instanceof Response) return error; throw error; }
  return next();
};
export function secureHeaders(headers: Record<string, string> = {}): Middleware {
  return async (_ctx, next) => {
    const res = await next();
    const out = new Response(res.body, res);
    for (const [key, value] of Object.entries({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY", ...headers })) out.headers.set(key, value);
    return out;
  };
}
export function cors(options: { origins: readonly string[]; credentials?: boolean; methods?: string[]; headers?: string[] }): Middleware {
  if (options.origins.includes("*")) throw new TypeError("Use explicit CORS origins");
  const allowed = new Set(options.origins.map(o => new URL(o).origin));
  const methods = options.methods ?? ["GET", "POST", "PUT", "PATCH", "DELETE"];
  return async (ctx, next) => {
    const origin = ctx.request.headers.get("origin");
    if (!origin) return next();
    if (!allowed.has(origin)) return new Response(null, { status: 403 });
    const preflight = ctx.request.method === "OPTIONS" && ctx.request.headers.has("access-control-request-method");
    if (preflight && !methods.includes(ctx.request.headers.get("access-control-request-method")!)) return new Response(null, { status: 403 });
    const allowedHeaders = (options.headers ?? ["content-type"]).map(h => h.toLowerCase());
    const requested = (ctx.request.headers.get("access-control-request-headers") ?? "").split(",").map(h => h.trim().toLowerCase()).filter(Boolean);
    if (preflight && requested.some(h => !allowedHeaders.includes(h))) return new Response(null, { status: 403 });
    const res = preflight ? new Response(null, { status: 204 }) : await next();
    const out = new Response(res.body, res);
    out.headers.append("Vary", "Origin");
    out.headers.set("Access-Control-Allow-Origin", origin);
    if (options.credentials) out.headers.set("Access-Control-Allow-Credentials", "true");
    if (preflight) {
      out.headers.set("Access-Control-Allow-Methods", methods.join(", "));
      out.headers.set("Access-Control-Allow-Headers", allowedHeaders.join(", "));
      out.headers.append("Vary", "Access-Control-Request-Method, Access-Control-Request-Headers");
    }
    return out;
  };
}
/** Fixed-window limiter. Bound cardinality; refuse new keys when full rather than evict active limits. */
export function createRateLimiter(options: { limit: number; windowMs: number; maxKeys?: number; now?: () => number }) {
  const { limit, windowMs, maxKeys = 10000, now = Date.now } = options;
  if (![limit, windowMs, maxKeys].every(n => Number.isSafeInteger(n) && n > 0)) throw new TypeError("Invalid rate limit");
  const windows = new Map<string, { count: number; expires: number }>();
  return {
    consume(key: string) {
      if (typeof key !== "string" || key.length > 256) throw new TypeError("Rate-limit keys must be at most 256 characters");
      const time = now();
      for (const [id, entry] of windows) { if (entry.expires > time) break; windows.delete(id); }
      let entry = windows.get(key);
      if (!entry) {
        if (windows.size >= maxKeys) return { allowed: false, remaining: 0, retryAfter: Math.max(1, Math.ceil(((windows.values().next().value?.expires ?? time + windowMs) - time) / 1000)) };
        windows.set(key, entry = { count: 0, expires: time + windowMs });
      }
      const allowed = entry.count < limit;
      if (allowed) entry.count++;
      return { allowed, remaining: Math.max(0, limit - entry.count), retryAfter: Math.max(1, Math.ceil((entry.expires - time) / 1000)) };
    },
    get size() { return windows.size; },
  };
}
