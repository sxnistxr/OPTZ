// Typed client for the Rust engine (engine/), mounted at /api/social. In production nginx
// sends these requests straight to the engine; they never touch the Bun server.
// The types mirror the engine's JSON exactly (see engine/README.md and SPEC.md).
import { activeToken } from "./auth";

export const SOCIAL = "/api/social";

export interface Post {
  id: number;
  body: string;
  /** UTC, millisecond precision: "2025-12-31T23:59:19.409Z" */
  created_at: string;
  author: string;
  like_count: number;
}
export interface LikeResult {
  liked: true;
  already_liked: boolean;
  post_id: number;
}
export interface Health {
  status: "ok" | "degraded";
  db: "ok" | "unreachable";
  uptime_s: number;
}

export class SocialError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".");

async function call<T>(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = activeToken();
  if (init.method === "POST" && t) headers.Authorization = `Bearer ${t}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(SOCIAL + path, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch {
    throw new SocialError("Couldn't reach the server. Check your connection and try again.", 0);
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || data === null) {
    const msg = data?.error ?? `The server answered ${res.status}.`;
    throw new SocialError(res.status === 401 ? `The server rejected your token (${msg}). Paste a new one.` : sentence(msg), res.status);
  }
  return data;
}

export const social = {
  feed: () => call<{ posts: Post[] }>("/feed").then((r) => r.posts),
  post: (id: string) => call<{ post: Post }>(`/posts/${encodeURIComponent(id)}`).then((r) => r.post),
  create: (body: string) => call<{ post: Post }>("/posts", { method: "POST", body: { body } }).then((r) => r.post),
  like: (id: number) => call<LikeResult>(`/posts/${id}/like`, { method: "POST" }),
  health: () => call<Health>("/health"),
};
