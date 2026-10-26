// GET /api/blog: the post list as JSON. Typed end to end: `api("/api/blog")` returns PostMeta[].
import { json, type RouteCache } from "optz";
import { listPosts } from "$lib/posts";

// Posts only change on deploy; serve from memory for 5 minutes.
export const cache: RouteCache = { maxAge: 300, staleWhileRevalidate: 3600 };

export const GET = () => json({ posts: listPosts() });
