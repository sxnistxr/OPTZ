// optz/cdn: purging a CDN when pages change, for `revalidation.purge` in optz.config.ts.
//
//   import { cloudflarePurge } from "optz/cdn";
//   revalidation: { purge: cloudflarePurge({ zoneId: process.env.CF_ZONE_ID!, token: process.env.CF_API_TOKEN! }) }
//
// Pages carry Cache-Tag (Cloudflare) and Surrogate-Key (Fastly and others) headers when
// server.cdnMaxAge is set: "optz-path:<path>" plus the page's own tags, so a purge by tag
// reaches exactly the pages revalidateTag() named.
import type { RevalidationChange } from "./types";

/** The CDN tag for a page path. */
export const pathTag = (path: string) => `optz-path:${path === "" ? "/" : path}`;

export interface CloudflarePurgeOptions {
  zoneId: string;
  /** An API token with Zone > Cache Purge. */
  token: string;
  /** The site's public origin; default config.site.url (passed by optz). */
  origin?: string;
  /** Purge by tag (Cache-Tag) instead of by URL. Default true. */
  byTag?: boolean;
}

/** Purges Cloudflare's cache for what changed: by tag (paths become optz-path:<path>, layouts
 *  purge by prefix) or by URL. Errors are logged, never thrown into the request. */
export function cloudflarePurge(o: CloudflarePurgeOptions) {
  return async (change: RevalidationChange, origin = o.origin) => {
    const bodies: Array<Record<string, string[]>> = [];
    const tags = [...change.tags, ...change.paths.filter((p) => !p.prefix).map((p) => pathTag(p.path))];
    const prefixes = change.paths.filter((p) => p.prefix).map((p) => p.path);
    if (o.byTag !== false && tags.length) bodies.push({ tags });
    else if (origin) {
      const files = change.paths.filter((p) => !p.prefix).map((p) => new URL(p.path, origin).href);
      if (files.length) bodies.push({ files });
    }
    if (prefixes.length && origin) bodies.push({ prefixes: prefixes.map((p) => new URL(p, origin).host + p) });
    for (const body of bodies) {
      // Cloudflare takes at most 30 items per purge request.
      const [key, items] = Object.entries(body)[0];
      for (let i = 0; i < items.length; i += 30) {
        const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${o.zoneId}/purge_cache`, {
          method: "POST",
          headers: { Authorization: `Bearer ${o.token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ [key]: items.slice(i, i + 30) }),
        }).catch((e: Error) => e);
        if (res instanceof Error || !res.ok) console.error(`optz: Cloudflare purge failed: ${res instanceof Error ? res.message : `${res.status} ${await res.text()}`}`);
      }
    }
  };
}
