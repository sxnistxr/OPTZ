import type { Middleware } from "./types";
export interface RequestEvent { id: string; method: string; pathname: string; status: number; durationMs: number }
/** Opt-in observation; never copy cookies, authorization, body or query strings to events. */
export function observe(options: { onRequest?: (event: RequestEvent) => unknown; onError?: (error: unknown, event: Omit<RequestEvent, "status">) => unknown } = {}): Middleware {
  const notify = (fn: (() => unknown) | undefined) => {
    if (!fn) return;
    try { void Promise.resolve(fn()).catch(error => console.error("optz: observer failed", error)); }
    catch (error) { console.error("optz: observer failed", error); }
  };
  return async (ctx, next) => {
    const start = performance.now(), id = crypto.randomUUID();
    const base = { id, method: ctx.request.method, pathname: ctx.url.pathname };
    try {
      const res = await next();
      const durationMs = performance.now() - start;
      notify(options.onRequest && (() => options.onRequest!({ ...base, status: res.status, durationMs })));
      const out = new Response(res.body, res);
      out.headers.set("X-Request-Id", id);
      out.headers.append("Server-Timing", `app;dur=${durationMs.toFixed(2)}`);
      return out;
    } catch (error) {
      notify(options.onError && (() => options.onError!(error, { ...base, durationMs: performance.now() - start })));
      throw error;
    }
  };
}
