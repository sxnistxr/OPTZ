// optz/edge: the request handler as an edge worker (Cloudflare Workers, Deno Deploy, Vercel
// Edge). `optz build --target edge` generates a worker that uses this; import it yourself to
// put optz behind your own worker code.
//
//   export default createWorker({ manifest, config, files, modules });
//
// Each request gets the platform's `env` (read with env() from optz/server) and `waitUntil`
// (after() and waitUntil() use it), and `scheduled` runs app/scheduled.ts on Cron Triggers.
import { createApp, type App, type Platform } from "./handler";
import type { Manifest } from "./manifest";
import { send, type StaticEntry } from "./static";
import type { Middleware, ResolvedConfig } from "./types";

export interface WorkerContext {
  waitUntil(p: Promise<unknown>): void;
  passThroughOnException?(): void;
}

export interface WorkerOptions {
  manifest: Manifest;
  config: ResolvedConfig;
  /** Built files (dist/static) by URL path. Loaded on the first request. */
  files: () => Promise<Map<string, StaticEntry>>;
  /** Project modules by path relative to the project root ("app/routes/x.tsx"). */
  modules: Record<string, () => Promise<unknown>>;
}

/** The edge image endpoint: no image library, so it serves the original, and only a file
 *  this app built (an open redirect otherwise). */
export function edgeImages(req: Request, url: URL, files: Map<string, StaticEntry>): Promise<Response> {
  const src = url.searchParams.get("url") ?? "";
  let path: string | null = null;
  if (src.startsWith("/") && !src.startsWith("//")) {
    try {
      path = new URL(src, "http://x").pathname;
    } catch {}
  }
  const f = path ? files.get(path) : undefined;
  return Promise.resolve(f && f.type.startsWith("image/") ? send(f, req) : new Response("Not found", { status: 404 }));
}

export function createWorker({ manifest, config, files, modules }: WorkerOptions) {
  const load = (f: string) => {
    const m = modules[f];
    if (!m) throw new Error("optz: module not in the server bundle: " + f);
    return m();
  };
  const mwFile = Object.keys(modules).find((f) => /^app\/middleware\.(ts|tsx|js)$/.test(f));
  const middleware = async (): Promise<Middleware[]> => {
    if (!config.features.middleware || !mwFile) return [];
    const m = (await load(mwFile)) as { default?: Middleware | Middleware[] };
    return m.default ? (Array.isArray(m.default) ? m.default : [m.default]) : [];
  };
  let app: Promise<App> | undefined;
  const start = async () => {
    const platform: Platform = { load, images: edgeImages };
    return createApp({ manifest, config, files: await files(), middleware: await middleware(), platform });
  };
  const scheduledFile = Object.keys(modules).find((f) => /^app\/scheduled\.(ts|js)$/.test(f));
  return {
    async fetch(req: Request, env?: Record<string, unknown>, ctx?: WorkerContext): Promise<Response> {
      return (await (app ??= start())).fetch(req, { env, waitUntil: ctx ? (p) => ctx.waitUntil(p) : undefined });
    },
    /** Cron Triggers: app/scheduled.ts's default export gets (event, env, ctx). */
    async scheduled(event: unknown, env?: Record<string, unknown>, ctx?: WorkerContext): Promise<void> {
      if (!scheduledFile) return;
      const m = (await load(scheduledFile)) as { default?: (e: unknown, env: unknown, ctx: unknown) => unknown };
      await m.default?.(event, env, ctx);
    },
  };
}
