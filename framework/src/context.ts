// Per-request context for server code: what `headers()`, `cookies()`, `draftMode()`, `after()`
// and `revalidatePath()` (optz/server) read and write. Set for API routes, Server Actions and
// dynamic page renders; static pages are rendered at build time, without a request.
import { AsyncLocalStorage } from "node:async_hooks";
import type { Locals } from "./types";

export interface RequestStore {
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
}

export const als = new AsyncLocalStorage<RequestStore>();

export function store(fn: string): RequestStore {
  const s = als.getStore();
  if (!s) throw new Error(`optz: ${fn}() only works while handling a request (API routes, Server Actions, dynamic pages)`);
  return s;
}

/** Hooks the running app registers so revalidatePath/revalidateTag can reach its caches. */
export interface Revalidator {
  path(path: string, type: "page" | "layout"): void;
  tag(tag: string): void;
}
let revalidator: Revalidator | null = null;
export const setRevalidator = (r: Revalidator | null) => {
  revalidator = r;
};
export const getRevalidator = () => revalidator;

export const newStore = (init: Omit<RequestStore, "setCookies" | "after" | "revalidated">): RequestStore => ({ ...init, setCookies: [], after: [], revalidated: false });

/** Runs `fn` with a fresh request store and applies its cookies and `after()` work. */
export const withStore = (init: Omit<RequestStore, "setCookies" | "after" | "revalidated">, fn: (s: RequestStore) => Promise<Response>) => inStore(newStore(init), fn);

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
    setTimeout(() => {
      for (const j of jobs) {
        try {
          Promise.resolve(als.run(s, j)).catch((e) => console.error("optz: after():", e));
        } catch (e) {
          console.error("optz: after():", e);
        }
      }
    }, 0);
  }
  return out;
}
