// /_optz/image?url=/photo.jpg&w=640&q=75: resizes and re-encodes images on demand (AVIF or
// WebP, whichever the browser accepts), once per size: results are kept in memory and on disk.
// Only widths from config.images.sizes, local files and allowed remote hosts are served, so the
// endpoint can't be used to make the server encode arbitrary images at arbitrary sizes.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

const memory = new Map<string, Out>();
let memoryBytes = 0;
const inflight = new Map<string, Promise<Out>>();
// One encode at a time: image encoding is CPU-bound, and the box may have one core.
let queue: Promise<unknown> = Promise.resolve();
const serial = <T,>(f: () => Promise<T>): Promise<T> => {
  const p = queue.then(f, f);
  queue = p.catch(() => {});
  return p;
};

const bad = (msg: string, status = 400) => new Response(msg, { status, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });

export async function handleImage(req: Request, url: URL, { root, config, files }: Ctx): Promise<Response> {
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
    if (u.protocol !== "https:" || !(o.remoteHosts ?? []).includes(u.hostname)) return bad(`${u.hostname} isn't in images.remoteHosts`, 403);
    const r = await fetch(u, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r?.ok) return bad("couldn't fetch the image", 502);
    const len = Number(r.headers.get("content-length") ?? 0);
    if (len > 20 << 20) return bad("image too large", 413);
    input = new Uint8Array(await r.arrayBuffer());
    if (input.length > 20 << 20) return bad("image too large", 413);
    srcType = r.headers.get("content-type") ?? "";
    srcTag = r.headers.get("etag") ?? String(input.length);
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

  const dir = join(root, ".optz/cache/images");
  const file = join(dir, `${key}.${fmt}`);
  let p = inflight.get(key);
  if (!p) {
    p = (async (): Promise<Out> => {
      if (existsSync(file)) return { body: readFileSync(file), type: `image/${fmt}`, etag: `"${key}"` };
      const sharp = await loadSharp();
      if (!sharp) return { body: input, type: srcType, etag: `"${key}-orig"` };
      const body = await serial(async () => {
        const img = sharp(input, { failOn: "error", limitInputPixels: 40_000_000 }).rotate().resize({ width, withoutEnlargement: true });
        const enc = fmt === "avif" ? img.avif({ quality: Math.max(1, q - 20), effort: 3 }) : fmt === "webp" ? img.webp({ quality: q }) : fmt === "png" ? img.png({ palette: true, quality: q }) : img.jpeg({ quality: q, mozjpeg: true });
        return new Uint8Array(await enc.toBuffer());
      });
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, body);
      trimDisk(dir, (o.cacheMB ?? 256) << 20);
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
  memory.set(key, out);
  memoryBytes += out.body.length;
  while (memoryBytes > 32 << 20) {
    const [k, v] = memory.entries().next().value as [string, Out];
    memory.delete(k);
    memoryBytes -= v.body.length;
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

let lastTrim = 0;
function trimDisk(dir: string, max: number) {
  if (Date.now() - lastTrim < 60_000) return;
  lastTrim = Date.now();
  const files = readdirSync(dir).map((f) => {
    const s = statSync(join(dir, f));
    return { f, size: s.size, at: s.atimeMs };
  });
  let total = files.reduce((n, x) => n + x.size, 0);
  for (const x of files.sort((a, b) => a.at - b.at)) {
    if (total <= max) break;
    unlinkSync(join(dir, x.f));
    total -= x.size;
  }
}
