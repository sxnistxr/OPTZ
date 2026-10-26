// GET /api/status: how the site and the engine are doing.
import { json, type RouteCache } from "optz";
import type { Health } from "$lib/social";
import config from "../../optz.config";

const started = Date.now();
const engine = config.proxy?.["/api/social"]?.target ?? "http://127.0.0.1:3000";

// Cheap, but cached for 5 s anyway: a status page shouldn't add load when it's popular.
export const cache: RouteCache = { maxAge: 5, staleWhileRevalidate: 30 };

export async function GET() {
  let health: Health | null = null;
  try {
    const r = await fetch(`${engine}/health`, { signal: AbortSignal.timeout(1000) });
    health = (await r.json()) as Health;
  } catch {}
  const mem = process.memoryUsage();
  return json({
    site: { uptimeSeconds: Math.round((Date.now() - started) / 1000), rssMiB: Math.round(mem.rss / 1048576) },
    engine: health ? { ok: health.status === "ok", uptimeSeconds: health.uptime_s } : { ok: false, uptimeSeconds: 0 },
  });
}
