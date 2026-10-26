// GET /api/blog: the post list as JSON. Typed end to end: `api("/api/blog")` returns PostMeta[].
import { json, type RouteCache } from "optz";
import { listPosts } from "$lib/posts";

// Posts only change on deploy: built once at build time, then served from memory like a page.
export const prerender = true;
export const cache: RouteCache = { maxAge: 300, staleWhileRevalidate: 3600 };

export const GET = () => json({ posts: listPosts() });
