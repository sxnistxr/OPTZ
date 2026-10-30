// Optional server-only Cloudflare adapter; no CDN client in normal serving or browser code.
import type { RevalidationChange } from "./types";
import { readBody } from "./body";
export const pathTag = (path: string) => `optz-path:${path === "" ? "/" : path}`;
export interface CloudflarePurgeOptions {
  zoneId: string;
  token: string;
  origin?: string;
  byTag?: boolean;
  mode?: "purge" | "invalidate";
  timeoutMs?: number;
  onError?: (error: Error) => void;
}
export type CloudflareTarget = { files: string[] } | { tags: string[] } | { prefixes: string[] } | { hosts: string[] } | { purge_everything: true };
const webUrl = (value: string) => {
  const u = new URL(value);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.hash) throw new TypeError("Invalid cache URL");
  return u.href;
};
/** Explicit API: failures throw safe errors. No widening to purge-everything or hidden retries. */
export async function purgeCloudflare(options: CloudflarePurgeOptions, target: CloudflareTarget) {
  if (!/^[a-f0-9]{32}$/i.test(options.zoneId) || !options.token || /[\r\n]/.test(options.token)) throw new TypeError("Invalid Cloudflare credentials");
  const timeout = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60000 || (options.mode && !["purge", "invalidate"].includes(options.mode))) throw new TypeError("Invalid Cloudflare request options");
  const keys = Object.keys(target);
  if (keys.length !== 1 || !["files", "tags", "prefixes", "hosts", "purge_everything"].includes(keys[0])) throw new TypeError("Select exactly one cache target");
  const key = keys[0];
  const value = (target as unknown as Record<string, unknown>)[key];
  let batches: Record<string, unknown>[];
  if (key === "purge_everything") {
    if (value !== true) throw new TypeError("purge_everything must be explicitly true");
    batches = [{ purge_everything: true }];
  } else {
    if (!Array.isArray(value) || value.length > 10000 || value.some(v => typeof v !== "string" || !v || v.length > 2048 || /[\u0000-\u001f]/.test(v))) throw new TypeError("Invalid cache targets");
    const items = [...new Set(value as string[])];
    for (const item of items) {
      if (key === "files") webUrl(item);
      if (key === "tags" && (item.length > 512 || /[,\s]/.test(item))) throw new TypeError("Invalid cache tag");
      if (key === "hosts" && !/^[a-z0-9.-]+$/i.test(item)) throw new TypeError("Invalid cache hostname");
      if (key === "prefixes" && (!/^[a-z0-9.-]+(?::[0-9]+)?\//i.test(item) || /[?#]/.test(item))) throw new TypeError("Prefixes require hostname/path without scheme or query");
    }
    batches = [];
    for (let i = 0; i < items.length; i += 100) batches.push({ [key]: items.slice(i, i + 100) });
  }
  for (const body of batches) {
    let response: Response;
    try { response = await fetch(`https://api.cloudflare.com/client/v4/zones/${options.zoneId}/${options.mode === "invalidate" ? "invalidate_cache" : "purge_cache"}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Bearer ${options.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    }); } catch { throw new Error("Cloudflare cache request failed or timed out"); }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Cloudflare cache request rejected (HTTP ${response.status})`); }
    let result: { success?: boolean };
    try { result = JSON.parse(new TextDecoder().decode(await readBody(response.body, 1 << 20, timeout))); } catch { throw new Error("Invalid Cloudflare cache response"); }
    if (!result || result.success !== true) throw new Error("Cloudflare did not accept the cache request");
  }
  return { acceptedBatches: batches.length };
}
/** Revalidation hook: failures are reported without failing a completed application mutation. */
export function cloudflarePurge(options: CloudflarePurgeOptions) {
  return async (change: RevalidationChange, origin = options.origin) => {
    try {
      const paths = change.paths.filter(p => !p.prefix).map(p => p.path);
      const prefixes = change.paths.filter(p => p.prefix).map(p => p.path);
      if (options.byTag !== false) {
        const tags = [...change.tags, ...paths.map(pathTag)];
        if (tags.length) await purgeCloudflare(options, { tags });
      } else if (paths.length) {
        if (!origin) throw new Error("URL purging requires an origin");
        const base = new URL(webUrl(origin));
        const files = paths.map(path => {
          if (!path.startsWith("/") || path.startsWith("//")) throw new TypeError("Cache paths must be local absolute paths");
          const url = new URL(path, base); if (url.origin !== base.origin) throw new TypeError("Cache path escaped the configured origin"); return url.href;
        });
        await purgeCloudflare(options, { files });
        if (change.tags.length) throw new Error("Tag-only changes require byTag mode; URL purging cannot safely expand tags");
      } else if (change.tags.length) throw new Error("Tag-only changes require byTag mode");
      if (prefixes.length) {
        if (!origin) throw new Error("Prefix purging requires an origin");
        const base = new URL(webUrl(origin));
        if (prefixes.some(path => !path.startsWith("/") || path.startsWith("//") || /[?#]/.test(path))) throw new TypeError("Invalid local cache prefix");
        await purgeCloudflare(options, { prefixes: prefixes.map(path => base.host + path) });
      }
    } catch (error) {
      const safe = error instanceof Error ? error : new Error("Cloudflare cache operation failed");
      if (options.onError) { try { options.onError(safe); } catch { console.error("optz: CDN error callback failed"); } }
      else console.error(`optz: ${safe.message}`);
    }
  };
}
