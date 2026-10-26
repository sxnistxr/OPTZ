// GET /api/status: how the site and the engine are doing.
import type { Health } from "$lib/social";

const started = Date.now();
export const dynamic = "force-dynamic";

export async function GET() {
  let health: Health | null = null;
  try {
    const r = await fetch("http://127.0.0.1:3000/health", { signal: AbortSignal.timeout(1000), cache: "no-store" });
    health = (await r.json()) as Health;
  } catch {}
  const mem = process.memoryUsage();
  return Response.json({
    site: { uptimeSeconds: Math.round((Date.now() - started) / 1000), rssMiB: Math.round(mem.rss / 1048576) },
    engine: health ? { ok: health.status === "ok", uptimeSeconds: health.uptime_s } : { ok: false, uptimeSeconds: 0 },
  });
}
