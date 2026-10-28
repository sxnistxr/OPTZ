// optz/server: functions for server code (API routes, Server Actions, dynamic pages, loaders).
// Never import this from an island or other browser code.
import { als, dataCaches, getRevalidator, store, type AppServices } from "./context";

export { NotFound, notFound, redirect } from "./index";

/** The current request's headers (read-only). Reading one makes a cached response private
 *  unless the route's `cache.vary` lists it. */
export function headers(): Headers {
  const s = store("headers");
  const h = s.request.headers;
  const note = (name: string) => s.reads.add(name.toLowerCase());
  return new Proxy(h, {
    get(t, k) {
      if (k === "get" || k === "has") return (name: string) => (note(name), t[k](name));
      if (k === "entries" || k === "forEach" || k === "keys" || k === "values" || k === Symbol.iterator) {
        t.forEach((_v, name) => note(name));
      }
      const v = Reflect.get(t, k, t);
      return typeof v === "function" ? v.bind(t) : v;
    },
  });
}

export interface CookieOptions {
  maxAge?: number;
  expires?: Date;
  path?: string;
  domain?: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "strict" | "lax" | "none";
}

/** Cookie names are RFC 6265 tokens: no spaces, separators or control characters. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** Domain and Path attribute values: no ";" and no control characters. */
const ATTR = /^[^;\x00-\x1f\x7f]*$/;

export function serializeCookie(name: string, value: string, o: CookieOptions = {}) {
  if (!TOKEN.test(name)) throw new TypeError(`optz: invalid cookie name ${JSON.stringify(name)}`);
  const path = o.path ?? "/";
  if (!ATTR.test(path)) throw new TypeError(`optz: invalid cookie path ${JSON.stringify(path)}`);
  if (o.domain !== undefined && !ATTR.test(o.domain)) throw new TypeError(`optz: invalid cookie domain ${JSON.stringify(o.domain)}`);
  const sameSite = o.sameSite ?? "lax";
  if (!["strict", "lax", "none"].includes(sameSite)) throw new TypeError(`optz: invalid SameSite ${JSON.stringify(sameSite)}`);
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}`;
  if (o.maxAge !== undefined) c += `; Max-Age=${Math.floor(o.maxAge)}`;
  if (o.expires) c += `; Expires=${o.expires.toUTCString()}`;
  if (o.domain) c += `; Domain=${o.domain}`;
  // Browsers drop SameSite=None cookies that aren't Secure.
  if (o.secure || sameSite === "none") c += "; Secure";
  if (o.httpOnly ?? true) c += "; HttpOnly";
  c += `; SameSite=${sameSite[0].toUpperCase() + sameSite.slice(1)}`;
  return c;
}

/** Parses a Cookie header. The first value of a name wins (browsers send the most specific
 *  path first); quoted values are unquoted. */
export function parseCookies(header: string | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    if (!k || m.has(k)) continue;
    let v = part.slice(i + 1).trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try {
      m.set(k, decodeURIComponent(v));
    } catch {
      m.set(k, v);
    }
  }
  return m;
}

/** Read the request's cookies; set and delete them on the response (API routes and Server
 *  Actions; a page render can only read). HttpOnly and SameSite=Lax unless you say otherwise. */
export function cookies() {
  const s = store("cookies");
  s.reads.add("cookie");
  const jar = parseCookies(s.request.headers.get("cookie"));
  const secure = s.url.protocol === "https:" || s.request.headers.get("x-forwarded-proto") === "https";
  return {
    get: (name: string) => jar.get(name),
    has: (name: string) => jar.has(name),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set(name: string, value: string, o: CookieOptions = {}) {
      jar.set(name, value);
      s.setCookies.push(serializeCookie(name, value, { secure, ...o }));
    },
    delete(name: string, o: Pick<CookieOptions, "path" | "domain"> = {}) {
      jar.delete(name);
      s.setCookies.push(serializeCookie(name, "", { ...o, maxAge: 0 }));
    },
  };
}

export const DRAFT_COOKIE = "__optz_draft";
/** Draft mode: static pages render per request (for previewing unpublished content) while the
 *  cookie is set. Turn it on from an API route your CMS calls, after checking its secret. */
export function draftMode() {
  const s = store("draftMode");
  return {
    isEnabled: s.draft,
    enable() {
      const draftToken = s.services?.draftToken;
      if (!draftToken) throw new Error("optz: draft mode isn't available here");
      const t = draftToken();
      s.setCookies.push(serializeCookie(DRAFT_COOKIE, t.value, { secure: s.url.protocol === "https:", maxAge: t.maxAge }));
      s.draft = true;
    },
    disable() {
      s.setCookies.push(serializeCookie(DRAFT_COOKIE, "", { maxAge: 0 }));
      s.draft = false;
    },
  };
}

/** Rebuild the page at `path` on its next request (static pages) and drop cached responses
 *  for it. With type "layout", every path under it. Call it after changing data. */
export function revalidatePath(path: string, type: "page" | "layout" = "page") {
  const r = getRevalidator();
  if (!r) throw new Error("optz: revalidatePath() needs a running server");
  r.path(path, type);
  markRevalidated();
}

/** Rebuild static pages and drop cached responses that list `tag` in their `tags`. */
export function revalidateTag(tag: string) {
  const r = getRevalidator();
  if (!r) throw new Error("optz: revalidateTag() needs a running server");
  r.tag(tag);
  markRevalidated();
}

function markRevalidated() {
  try {
    store("revalidate").revalidated = true;
  } catch {}
}

/** The platform's bindings for this request: on edge workers, the `env` object (KV, D1, R2,
 *  secrets); elsewhere, process.env. */
export function env<T = Record<string, unknown>>(): T {
  const s = store("env");
  return (s.env ?? (typeof process !== "undefined" ? process.env : {})) as T;
}

/** Keep the request alive until `p` settles (edge workers stop when the response is sent
 *  otherwise). On Bun it simply runs. */
export function waitUntil(p: Promise<unknown>) {
  const s = store("waitUntil");
  const guarded = p.catch((e) => console.error("optz: waitUntil():", e));
  s.waitUntil?.(guarded);
}

/** Run `fn` after the response has been sent (logging, analytics, cache warming). Edge workers
 *  wait for it (waitUntil). */
export function after(fn: () => unknown) {
  store("after").after.push(fn);
}

/** The current locale (i18n). */
export function locale(): string | undefined {
  return store("locale").locale;
}

/** Throw this from a Server Action to send its message to the browser. Other errors are
 *  reported as "Something went wrong" in production, so they can't leak details. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionError";
  }
}

/** Memoizes a server function across requests: one call per distinct arguments (JSON) is shared
 *  by everyone until `revalidate` seconds pass or revalidateTag() names one of its `tags`.
 *  Concurrent calls share one promise; a call that fails isn't kept.
 *
 *    export const getPosts = cache(async (limit: number) => db.posts(limit), { tags: ["posts"], revalidate: 60 });
 *
 *  Only for data that's the same for every visitor: nothing request-specific goes in. */
export function cache<A extends unknown[], R>(fn: (...args: A) => R | Promise<R>, opts: { tags?: string[]; revalidate?: number; maxEntries?: number } = {}): (...args: A) => Promise<Awaited<R>> {
  type Entries = Map<string, { at: number; value: Promise<Awaited<R>> }>;
  const globalEntries: Entries = new Map();
  const scoped = new WeakMap<AppServices, Entries>();
  const max = opts.maxEntries ?? 1000;
  dataCaches.add({ tags: opts.tags ?? [], clear: () => globalEntries.clear() });
  return (...args: A) => {
    const owner = als.getStore()?.services;
    let entries = owner ? scoped.get(owner) : globalEntries;
    if (!entries) {
      entries = new Map();
      scoped.set(owner!, entries);
      const owned = entries;
      (owner!.dataCaches ??= new Set()).add({ tags: opts.tags ?? [], clear: () => owned.clear() });
    }
    const key = JSON.stringify(args);
    const hit = entries.get(key);
    if (hit && (opts.revalidate === undefined || Date.now() - hit.at < opts.revalidate * 1000)) return hit.value;
    const value = Promise.resolve().then(() => fn(...args)) as Promise<Awaited<R>>;
    value.catch(() => entries.get(key)?.value === value && entries.delete(key));
    entries.delete(key);
    entries.set(key, { at: Date.now(), value });
    if (entries.size > max) entries.delete(entries.keys().next().value as string);
    return value;
  };
}

