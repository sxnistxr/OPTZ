// GET /api/status: how the site's server is doing (what the home page's live status times).
import { json, type RouteCache } from "optz";

const started = Date.now();

// Cheap, but cached for 2 s anyway: a status check shouldn't add load when it's popular.
export const cache: RouteCache = { maxAge: 2, staleWhileRevalidate: 30 };

export function GET() {
  const mem = process.memoryUsage();
  return json({ ok: true, uptimeSeconds: Math.round((Date.now() - started) / 1000), rssMiB: Math.round(mem.rss / 1048576) });
}
