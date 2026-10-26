// GET /api/blog: the post list as JSON. Prerendered at build, regenerated at most every 300 s.
import { listPosts } from "$lib/posts";

export const revalidate = 300;

export function GET() {
  return Response.json({ posts: listPosts() });
}
