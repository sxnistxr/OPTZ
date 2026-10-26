// optz/server: functions for server code (API routes, Server Actions, dynamic pages, loaders).
// Never import this from an island or other browser code.
import { getRevalidator, store } from "./context";

export { NotFound, notFound, redirect } from "./index";

/** The current request's headers (read-only). */
export function headers(): Headers {
  return store("headers").request.headers;
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

export function serializeCookie(name: string, value: string, o: CookieOptions = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${o.path ?? "/"}`;
  if (o.maxAge !== undefined) c += `; Max-Age=${Math.floor(o.maxAge)}`;
  if (o.expires) c += `; Expires=${o.expires.toUTCString()}`;
  if (o.domain) c += `; Domain=${o.domain}`;
  if (o.secure) c += "; Secure";
  if (o.httpOnly ?? true) c += "; HttpOnly";
  c += `; SameSite=${o.sameSite ? o.sameSite[0].toUpperCase() + o.sameSite.slice(1) : "Lax"}`;
  return c;
}

export function parseCookies(header: string | null): Map<string, string> {
  const m = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim();
    try {
      m.set(k, decodeURIComponent(part.slice(i + 1).trim()));
    } catch {
      m.set(k, part.slice(i + 1).trim());
    }
  }
  return m;
}

/** Read the request's cookies; set and delete them on the response (API routes and Server
 *  Actions; a page render can only read). HttpOnly and SameSite=Lax unless you say otherwise. */
export function cookies() {
  const s = store("cookies");
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
let draftToken: (() => string) | null = null;
/** Set by the server: the signed value the draft cookie must have. */
export const setDraftToken = (f: () => string) => {
  draftToken = f;
};

/** Draft mode: static pages render per request (for previewing unpublished content) while the
 *  cookie is set. Turn it on from an API route your CMS calls, after checking its secret. */
export function draftMode() {
  const s = store("draftMode");
  return {
    isEnabled: s.draft,
    enable() {
      if (!draftToken) throw new Error("optz: draft mode isn't available here");
      s.setCookies.push(serializeCookie(DRAFT_COOKIE, draftToken(), { secure: s.url.protocol === "https:" }));
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

/** Run `fn` after the response has been sent (logging, analytics, cache warming). */
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
