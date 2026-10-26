// The posting token, kept in localStorage and shared by every component that needs it.
import { useSyncExternalStore } from "react";

const KEY = "optz.token";
export interface Claims {
  sub: string;
  username: string;
  exp: number;
}
export interface Auth {
  token: string;
  claims: Claims;
  expired: boolean;
}

export function decodeToken(t: string): Claims | null {
  try {
    const p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const c = JSON.parse(atob(p + "=".repeat((4 - (p.length % 4)) % 4)));
    return typeof c.username === "string" && typeof c.exp === "number" ? c : null;
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
let cached: { raw: string | null; value: Auth | null } = { raw: null, value: null };

function read(): Auth | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {}
  if (raw === cached.raw) return cached.value;
  const claims = raw ? decodeToken(raw) : null;
  cached = { raw, value: raw && claims ? { token: raw, claims, expired: claims.exp * 1000 <= Date.now() } : null };
  return cached.value;
}

export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem(KEY, t);
    else localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  addEventListener("storage", l);
  return () => {
    listeners.delete(l);
    removeEventListener("storage", l);
  };
};

/** The saved token (null on the server and before hydration finishes reading storage). */
export const useAuth = () => useSyncExternalStore(subscribe, read, () => null);
/** A token that can be used right now. */
export const useActiveAuth = () => {
  const a = useAuth();
  return a && !a.expired ? a : null;
};
export const activeToken = () => {
  const a = read();
  return a && !a.expired ? a.token : null;
};
