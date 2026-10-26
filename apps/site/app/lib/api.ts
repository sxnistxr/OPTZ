// Browser client for the Rust API under /api. Requests go straight from the browser to the API
// (through nginx), never through the Bun server.
import { activeToken } from "./auth";

export interface Post {
  id: number;
  body: string;
  created_at: string;
  author: string;
  like_count: number;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1) + (/[.!?]$/.test(s) ? "" : ".");

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = activeToken();
  if (init.method && init.method !== "GET" && t) headers.Authorization = `Bearer ${t}`;
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  } catch {
    throw new ApiError("Couldn't reach the server. Check your connection and try again.", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error ?? `The server answered ${res.status}.`;
    throw new ApiError(res.status === 401 ? `The server rejected your token (${msg}). Paste a new one.` : sentence(msg), res.status);
  }
  return data as T;
}

export const api = {
  feed: () => call<{ posts: Post[] }>("/feed").then((r) => r.posts),
  post: (id: string) => call<{ post: Post }>(`/posts/${encodeURIComponent(id)}`).then((r) => r.post),
  create: (body: string) => call<{ post: Post }>("/posts", { method: "POST", body: { body } }).then((r) => r.post),
  like: (id: number) => call<{ liked: boolean; already_liked: boolean }>(`/posts/${id}/like`, { method: "POST" }),
  health: () => call<{ status: string; uptime_s: number }>("/health"),
};
