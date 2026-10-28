// Optional opaque sessions: portable storage contract, no database or auth provider in core.
import { serializeCookie } from "./server-api";

/** expiresAt is milliseconds since the Unix epoch. Store only the minimum application identity. */
export interface Session<T> { data: T; expiresAt: number }
export interface SessionStore<T> {
  get(key: string): Session<T> | undefined | Promise<Session<T> | undefined>;
  set(key: string, value: Session<T>): void | Promise<void>;
  delete(key: string): void | Promise<void>;
}
const hex = (bytes: Uint8Array) => [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
async function digest(token: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
}
export function createSessions<T>(options: { store: SessionStore<T>; secure?: boolean; name?: string; maxAge?: number; now?: () => number }) {
  const { store, secure = true, now = Date.now, maxAge = 604800 } = options;
  const name = options.name ?? (secure ? "__Host-optz_session" : "optz_session");
  if (!Number.isInteger(maxAge) || maxAge < 1 || maxAge > 31536000) throw new TypeError("Invalid session lifetime");
  if (name.startsWith("__Host-") && !secure) throw new TypeError("__Host- cookies require HTTPS");
  const cookie = (value: string, age = maxAge) => serializeCookie(name, value, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: age });
  cookie("", 0); // Validate configuration before writing any session records.
  const token = (req: Request) => {
    const value = req.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(name + "="))?.slice(name.length + 1);
    return value && /^[a-f0-9]{64}$/.test(value) ? value : undefined;
  };
  return {
    async read(req: Request): Promise<Session<T> | undefined> {
      const raw = token(req);
      if (!raw) return;
      const key = await digest(raw), session = await store.get(key);
      if (session && session.expiresAt > now()) return session;
      if (session) await store.delete(key);
    },
    /** Always mint a fresh identity after login/privilege changes, revoking the old cookie. */
    async create(data: T, previous?: Request) {
      const raw = hex(crypto.getRandomValues(new Uint8Array(32)));
      await store.set(await digest(raw), { data, expiresAt: now() + maxAge * 1000 });
      const old = previous && token(previous);
      if (old) await store.delete(await digest(old));
      return cookie(raw);
    },
    async destroy(req: Request) {
      const raw = token(req);
      if (raw) await store.delete(await digest(raw));
      return cookie("", 0);
    },
  };
}

/** Bounded single-process store for tests/prototypes. Use persistent shared storage in production. */
export function memorySessionStore<T>(maxEntries = 1000, now = Date.now): SessionStore<T> {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new TypeError("Invalid session capacity");
  const entries = new Map<string, Session<T>>();
  return {
    get: key => entries.get(key),
    set(key, value) {
      for (const [id, entry] of entries) if (entry.expiresAt <= now()) entries.delete(id);
      if (!entries.has(key) && entries.size >= maxEntries) throw new Error("Session capacity exceeded");
      entries.set(key, value);
    },
    delete: key => { entries.delete(key); },
  };
}
