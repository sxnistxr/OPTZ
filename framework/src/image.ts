// /_optz/image?url=/photo.jpg&w=640&q=75: resizes and re-encodes images on demand (AVIF or
// WebP, whichever the browser accepts), once per size: results are kept in memory and on disk.
// Only widths from config.images.sizes, local files and allowed remote hosts are served, so the
// endpoint can't be used to make the server encode arbitrary images at arbitrary sizes.
//
// Encodes run in a small pool (images.concurrency, default the cores minus one, at least one)
// and all disk I/O is async. The disk cache is images.cacheDir, OPTZ_IMAGE_CACHE_DIR or
// .optz/cache/images; if it can't be written (a read-only deploy), images are still served
// from memory.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { isAbsolute, join } from "node:path";
import { fetchRemoteImage, ImageDownloadError } from "./remote-image";
import type { StaticEntry } from "./static";
import type { ResolvedConfig } from "./types";

export const DEFAULT_SIZES = [384, 640, 828, 1080, 1200, 1920, 2048];

interface Ctx {
  root: string;
  config: ResolvedConfig;
  files: Map<string, StaticEntry>;
}

interface Out {
  body: Uint8Array;
  type: string;
  etag: string;
}

// State belongs to this app's static-file map, never to another app in the process.
interface ImageState {
  memory: Map<string, Out>;
  memoryBytes: number;
  inflight: Map<string, Promise<Out>>;
  sources: Map<string, Promise<{ body: Uint8Array; type: string }>>;
  active: number;
  waiting: Array<() => void>;
  diskWarned: boolean;
  lastTrim: number;
}
const states = new WeakMap<Map<string, StaticEntry>, ImageState>();
const defaultConcurrency = () => Math.max(1, Math.min(4, availableParallelism() - 1));

/** Where optimized images are kept on disk. */
export function imageCacheDir(root: string, config: ResolvedConfig): string {
  const d = config.images?.cacheDir ?? (typeof process !== "undefined" ? process.env.OPTZ_IMAGE_CACHE_DIR : undefined);
  return d ? (isAbsolute(d) ? d : join(root, d)) : join(root, ".optz/cache/images");
}

const bad = (msg: string, status = 400) => new Response(msg, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });

export async function handleImage(req: Request, url: URL, ctx: Ctx): Promise<Response> {
  let state = states.get(ctx.files);
  if (!state) {
    state = { memory: new Map(), memoryBytes: 0, inflight: new Map(), sources: new Map(), active: 0, waiting: [], diskWarned: false, lastTrim: 0 };
    states.set(ctx.files, state);
  }
  // Admission happens before downloading/retaining inputs. The small queue holds requests only.
  const limit = Math.max(1, Math.min(4, Math.floor(ctx.config.images.concurrency ?? defaultConcurrency()) || 1));
  if (state.active >= limit) {
    if (state.waiting.length >= 8) return bad("image service busy", 503);
    await new Promise<void>((resolve) => state.waiting.push(resolve));
  } else state.active++;
  try { return await processImage(req, url, ctx, state); }
  catch (e) { return bad(e instanceof ImageDownloadError ? e.message : "couldn't process the image", e instanceof ImageDownloadError ? e.status : 422); }
  finally {
    const next = state.waiting.shift();
    if (next) next(); else state.active--;
  }
}

async function processImage(req: Request, url: URL, { root, config, files }: Ctx, state: ImageState): Promise<Response> {
  const { memory, inflight } = state;
  const o = config.images ?? {};
  const sizes = (o.sizes ?? DEFAULT_SIZES).slice().sort((a, b) => a - b);
  const src = url.searchParams.get("url") ?? "";
  const w = Number(url.searchParams.get("w"));
  const q = Math.round(Number(url.searchParams.get("q") ?? o.quality ?? 75));
  if (!src) return bad('"url" is required');
  if (!Number.isInteger(w) || w <= 0) return bad('"w" must be a positive integer');
  if (!(q >= 1 && q <= 100)) return bad('"q" must be between 1 and 100');
  // Any width rounds up to an allowed one (so <Image> and the optimizer never disagree).
  const width = sizes.find((s) => s >= w) ?? sizes[sizes.length - 1];

  // ---- the source ----
  let input: Uint8Array;
  let srcType: string;
  let srcTag: string;
  if (src.startsWith("/") && !src.startsWith("//")) {
    const f = files.get(src.split("?")[0]);
    if (!f) return bad("image not found", 404);
    input = f.body;
    srcType = f.type;
    srcTag = f.etag;
  } else {
    let u: URL;
    try {
      u = new URL(src);
    } catch {
      return bad("bad url");
    }
    let source = state.sources.get(src);
    if (!source) {
      source = fetchRemoteImage(u, o.remoteHosts ?? []);
      state.sources.set(src, source);
      void source.finally(() => state.sources.delete(src)).catch(() => {});
    }
    const downloaded = await source;
    input = downloaded.body;
    srcType = downloaded.type;
    srcTag = createHash("sha256").update(input).digest("hex");
  }
  // Vector and animated images are sent as they are.
  if (srcType.includes("svg") || srcType.includes("gif")) {
    return new Response(input as BodyInit, { headers: { "Content-Type": srcType, "Cache-Control": "public, max-age=86400", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
  }

  const accept = req.headers.get("accept") ?? "";
  const fmt = (o.formats ?? ["avif", "webp"]).find((f) => accept.includes(`image/${f}`)) ?? (srcType.includes("png") ? "png" : "jpeg");
  const key = createHash("sha256").update(`${src}\n${srcTag}\n${width}\n${q}\n${fmt}`).digest("hex").slice(0, 32);
  const headers = (out: Out) => ({ "Content-Type": out.type, "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800", ETag: out.etag, Vary: "Accept" });

  const hit = memory.get(key);
  if (hit) {
    memory.delete(key);
    memory.set(key, hit);
    if (req.headers.get("if-none-match") === hit.etag) return new Response(null, { status: 304, headers: headers(hit) });
    return new Response(hit.body as BodyInit, { headers: headers(hit) });
  }

  const dir = imageCacheDir(root, config);
  const file = join(dir, `${key}.${fmt}`);
  let p = inflight.get(key);
  if (!p) {
    p = (async (): Promise<Out> => {
      const cached = await readFile(file).catch(() => null);
      if (cached) return { body: new Uint8Array(cached), type: `image/${fmt}`, etag: `"${key}"` };
      const sharp = await loadSharp();
      if (!sharp) return { body: input, type: srcType, etag: `"${key}-orig"` };
      const body = await (async () => {
        const img = sharp(input, { failOn: "error", limitInputPixels: 40_000_000 }).rotate().resize({ width, withoutEnlargement: true });
        const enc = fmt === "avif" ? img.avif({ quality: Math.max(1, q - 20), effort: 3 }) : fmt === "webp" ? img.webp({ quality: q }) : fmt === "png" ? img.png({ palette: true, quality: q }) : img.jpeg({ quality: q, mozjpeg: true });
        return new Uint8Array(await enc.toBuffer());
      })();
      // The disk copy is an optimization: a read-only cache directory only costs re-encodes.
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(file, body);
        void trimDisk(dir, (o.cacheMB ?? 256) * (1 << 20), state).catch(() => {});
      } catch (e) {
        if (!state.diskWarned) {
          state.diskWarned = true;
          console.warn(`optz: can't write the image cache in ${dir} (${(e as Error).message}); keeping optimized images in memory only. Set images.cacheDir or OPTZ_IMAGE_CACHE_DIR to a writable directory.`);
        }
      }
      return { body, type: `image/${fmt}`, etag: `"${key}"` };
    })();
    inflight.set(key, p);
    p.finally(() => inflight.delete(key)).catch(() => {});
  }
  let out: Out;
  try {
    out = await p;
  } catch (e) {
    console.error(`optz: image ${src}:`, e);
    return bad("couldn't process the image", 422);
  }
  state.memoryBytes -= memory.get(key)?.body.length ?? 0;
  memory.set(key, out);
  state.memoryBytes += out.body.length;
  while (state.memoryBytes > 32 << 20 && memory.size) {
    const [k, v] = memory.entries().next().value as [string, Out];
    memory.delete(k);
    state.memoryBytes -= v.body.length;
  }
  return new Response(out.body as BodyInit, { headers: headers(out) });
}

type Sharp = typeof import("sharp").default;
let sharpMod: Promise<Sharp | null> | undefined;
/** sharp is optional (native code): without it, images are served as they are. */
const loadSharp = () =>
  (sharpMod ??= import("sharp").then(
    (m) => m.default,
    () => {
      console.warn("optz: sharp isn't installed, so /_optz/image serves images unchanged (bun add sharp)");
      return null;
    },
  ));

async function trimDisk(dir: string, max: number, state: ImageState) {
  if (Date.now() - state.lastTrim < 60_000) return;
  state.lastTrim = Date.now();
  const files = await Promise.all(
    (await readdir(dir)).map(async (f) => {
      const s = await stat(join(dir, f));
      return { f, size: s.size, at: s.atimeMs };
    }),
  );
  let total = files.reduce((n, x) => n + x.size, 0);
  for (const x of files.sort((a, b) => a.at - b.at)) {
    if (total <= max) break;
    await unlink(join(dir, x.f)).catch(() => {});
    total -= x.size;
  }
}
