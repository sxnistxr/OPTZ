// Build-time downloads (web fonts, Open Graph fonts), cached on disk across builds: a deploy
// doesn't re-download them, and doesn't fail when the source is slow or down as long as an
// earlier build cached them. The cache lives outside the project (OPTZ_CACHE_DIR, default
// ~/.cache/optz), so it survives fresh checkouts.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const cacheDir = (sub: string) => join(process.env.OPTZ_CACHE_DIR ?? join(homedir(), ".cache/optz"), sub);

/** Fetches `url` through the disk cache. Copies younger than `maxAgeDays` are used as they
 *  are; older ones are refreshed, and still used if the refresh fails. */
export async function cachedFetch(url: string, opts: { headers?: Record<string, string>; maxAgeDays?: number; sub?: string } = {}): Promise<Uint8Array> {
  const dir = cacheDir(opts.sub ?? "downloads");
  const file = join(dir, createHash("sha256").update(url + JSON.stringify(opts.headers ?? {})).digest("hex").slice(0, 32));
  const have = existsSync(file);
  if (have && Date.now() - statSync(file).mtimeMs < (opts.maxAgeDays ?? 30) * 86_400_000) return readFileSync(file);
  try {
    const r = await fetch(url, { headers: opts.headers, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) throw new Error(`${url} answered ${r.status}`);
    const b = new Uint8Array(await r.arrayBuffer());
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, b);
    return b;
  } catch (e) {
    if (have) {
      console.warn(`optz: ${(e as Error).message}; using the cached copy`);
      return readFileSync(file);
    }
    throw e;
  }
}
