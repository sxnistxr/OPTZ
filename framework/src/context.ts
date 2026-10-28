// Per-request context for server code: what `headers()`, `cookies()`, `draftMode()`, `after()`
// and `revalidatePath()` (optz/server) read and write. Set for API routes, Server Actions and
// dynamic page renders; static pages are rendered at build time, without a request.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Locals } from "./types";

export interface RequestStore {
  services?: AppServices;
  request: Request;
  url: URL;
  locals: Locals;
  locale?: string;
  draft: boolean;
  /** Set-Cookie values to add to the response. */
  setCookies: string[];
  /** Work to run after the response is sent. */
  after: Array<() => unknown>;
  /** Did this request call revalidatePath/revalidateTag? (Actions tell the browser to refresh.) */
  revalidated: boolean;
  /** Request headers server code read through headers()/cookies(), lowercased: a cached
   *  response that depends on one the route doesn't vary on mustn't be shared. */
  reads: Set<string>;
  /** Edge workers: the platform's bindings (KV, D1, R2, secrets) and its waitUntil(). */
  env?: Record<string, unknown>;
  waitUntil?: (p: Promise<unknown>) => void;
}

export const als = new AsyncLocalStorage<RequestStore>();

export function store(fn: string): RequestStore {
  const s = als.getStore();
  if (!s) throw new Error(`optz: ${fn}() only works while handling a request (API routes, Server Actions, dynamic pages)`);
  return s;
}

/** Track raw Request header reads at the user-code boundary, just like headers(). */
export function trackRequest(req: Request, s: RequestStore | undefined, url = req.url): Request {
  if (!s) return req;
  const headers = new Proxy(req.headers, {
    get(t, k) {
      if (k === "get" || k === "has") return (name: string) => { s.reads.add(name.toLowerCase()); return t[k](name); };
      if ((k === "entries" || k === "keys" || k === "values" || k === "forEach" || k === Symbol.iterator)) s.reads.add("*");
      const value = Reflect.get(t, k, t);
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
  return new Proxy(req, {
    get(t, k) {
      if (k === "url") return url;
      if (k === "headers") return headers;
      if (k === "clone") return () => trackRequest(t.clone(), s, url);
      const value = Reflect.get(t, k, t);
      return typeof value === "function" ? value.bind(t) : value;
    },
  });
}

/** Hooks the running app registers so revalidatePath/revalidateTag can reach its caches. */
export interface Revalidator {
  path(path: string, type: "page" | "layout"): void;
  tag(tag: string): void;
}
export interface AppServices {
  revalidator?: Revalidator;
  draftToken?: () => { value: string; maxAge: number };
  dataCaches?: Set<DataCache>;
}
export const getRevalidator = () => als.getStore()?.services?.revalidator;

export const newStore = (init: Omit<RequestStore, "setCookies" | "after" | "revalidated" | "reads" | "env" | "waitUntil"> & Partial<Pick<RequestStore, "env" | "waitUntil">>): RequestStore => ({ ...init, setCookies: [], after: [], revalidated: false, reads: new Set() });

/** Runs `fn` with a fresh request store and applies its cookies and `after()` work. */
export const withStore = (init: Omit<RequestStore, "setCookies" | "after" | "revalidated" | "reads" | "env" | "waitUntil"> & Partial<Pick<RequestStore, "env" | "waitUntil">>, fn: (s: RequestStore) => Promise<Response>) => inStore(newStore(init), fn);

/** Runs `fn` inside the request's store (entered only where server code can use it: static
 *  files skip it, which keeps them cheap) and applies its cookies and `after()` work. */
export async function inStore(s: RequestStore, fn: (s: RequestStore) => Promise<Response>): Promise<Response> {
  const res = await als.run(s, () => fn(s));
  let out = res;
  if (s.setCookies.length) {
    // Responses from fetch() or Response.redirect() can have immutable headers.
    try {
      for (const c of s.setCookies) res.headers.append("Set-Cookie", c);
    } catch {
      out = new Response(res.body, res);
      for (const c of s.setCookies) out.headers.append("Set-Cookie", c);
    }
    out.headers.set("Cache-Control", "private, no-store");
  }
  if (s.after.length) {
    const jobs = s.after;
    const done = new Promise<void>((resolve) =>
      setTimeout(async () => {
        for (const j of jobs) {
          try {
            await als.run(s, j);
          } catch (e) {
            console.error("optz: after():", e);
          }
        }
        resolve();
      }, 0),
    );
    // Edge workers stop once the response is sent unless told to wait.
    s.waitUntil?.(done);
  }
  return out;
}

/** Data caches made with cache() (optz/server): dropped by revalidateTag() for their tags. */
export interface DataCache {
  tags: string[];
  clear(): void;
}
export const dataCaches = new Set<DataCache>();
/** Drops every data cache that has one of `tags`. */
export function clearDataCaches(tags: string[], services?: AppServices) {
  if (!tags.length) return;
  for (const c of [...dataCaches, ...(services?.dataCaches ?? [])]) if (c.tags.some((t) => tags.includes(t))) c.clear();
}

