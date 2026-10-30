# Page caching and Cloudflare

OPTZ already has static files in memory, ISR, tagged server-function caching and an opt-in
response cache. The CDN integration extends those primitives; it does not add a second page
cache or a new browser runtime.

## Existing cache policy

Use a route's `cache` policy for intentional public dynamic/API responses, `revalidate` for
ISR pages, and `revalidatePath` / `revalidateTag` after mutations. Cookie/Authorization requests,
personal header reads, Set-Cookie and private/no-store responses bypass shared caching. Do not
try to make personalized responses public by adding a tag.

`server.cdnMaxAge` adds CDN freshness and page tags. Match your Cloudflare Cache Rules to these
headers; do not install a blanket cache-everything rule for authenticated APIs or action routes.

## Revalidation hook

```ts
import { defineConfig } from "optz";
import { cloudflarePurge } from "optz/cdn";

export default defineConfig({
  site: { url: process.env.PUBLIC_URL! },
  server: { cdnMaxAge: 300 },
  revalidation: {
    purge: cloudflarePurge({
      zoneId: process.env.CF_ZONE_ID!,
      token: process.env.CF_API_TOKEN!,
      mode: "purge",
      onError: () => console.error("CDN invalidation needs retry"),
    }),
  },
});
```

Default tag mode combines explicit tags with `optz-path:<path>` tags. Layout/prefix changes
purge a validated hostname/path prefix. `byTag: false` supports local path-to-URL purging, but
cannot safely expand a tag-only change to URLs: it reports that error instead of silently
purging the entire zone. Relative/foreign-origin path tricks are rejected.

The hook reports failures without failing a completed application mutation. For delivery
guarantees, enqueue a retry in your own durable worker; a response hook is not a durable queue.

## Explicit purge and soft invalidation

```ts
import { purgeCloudflare } from "optz/cdn";

const options = {
  zoneId: process.env.CF_ZONE_ID!,
  token: process.env.CF_API_TOKEN!,
};
await purgeCloudflare(options, { files: ["https://example.com/docs"] });
await purgeCloudflare(options, { tags: ["docs"] });
await purgeCloudflare(options, { prefixes: ["example.com/docs/"] });
await purgeCloudflare(options, { hosts: ["example.com"] });
// Broad removal is explicit, never a fallback after an error.
await purgeCloudflare(options, { purge_everything: true });

// Keep content stale for conditional revalidation instead of deleting it.
await purgeCloudflare({ ...options, mode: "invalidate" }, { tags: ["docs"] });
```

Exactly one target kind is accepted. URL targets reject credentials/fragments; prefix targets
use hostname/path without a scheme or query. Targets are deduplicated and sent in batches of
at most 100. Requests have a five-second default timeout (configurable 1–60,000 ms), reject
redirects and require both a successful HTTP status and `success: true` in the API response.
Errors do not echo response bodies or credentials. Empty targets do no network work.

No hidden retry storm follows a 429. Limits vary by Cloudflare plan and operation; schedule
backoff centrally when needed. Use a token scoped to the intended zone's **Cache Purge** permission.
Keep it server-only, for example in [Doppler](DOPPLER.md).

Purge removes content. Soft invalidation marks it stale, and the next request can reuse the
cached object after a 304 or replace it after a full origin response. A successful API result
means the request was accepted, not that an object was previously cached. Confirm the desired
`CF-Cache-Status` behavior against your configured zone.

Primary references: [purge API](https://developers.cloudflare.com/api/resources/cache/methods/purge/),
[availability and limits](https://developers.cloudflare.com/cache/how-to/purge-cache/),
[soft invalidation](https://developers.cloudflare.com/api/go/resources/cache/methods/invalidate/).
