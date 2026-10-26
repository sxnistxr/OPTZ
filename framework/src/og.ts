// Renders `*.og.tsx` components to PNG (satori draws the SVG, resvg rasterizes it). Static pages
// get theirs at build time; others on first request, then from the response cache.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { OgFont, OgModule } from "./og-types";

interface SatoriFont {
  name: string;
  data: ArrayBuffer;
  weight?: OgFont["weight"];
  style?: OgFont["style"];
}

const fontCache = new Map<string, Promise<SatoriFont[]>>();

async function fetchCached(root: string, url: string, headers: Record<string, string> = {}): Promise<Uint8Array> {
  const dir = join(root, ".optz/cache/fonts");
  const file = join(dir, createHash("sha256").update(url + JSON.stringify(headers)).digest("hex").slice(0, 24));
  if (existsSync(file)) return readFileSync(file);
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const b = new Uint8Array(await r.arrayBuffer());
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, b);
  return b;
}

/** TTF files for a Google Fonts css2 URL (an old user agent gets TrueType instead of WOFF2). */
async function googleTtf(root: string, cssUrl: string): Promise<SatoriFont[]> {
  const css = new TextDecoder().decode(await fetchCached(root, cssUrl, { "User-Agent": "Mozilla/4.0" }));
  const out: SatoriFont[] = [];
  for (const block of css.split("@font-face").slice(1)) {
    const name = block.match(/font-family:\s*'([^']+)'/)?.[1];
    const url = block.match(/url\((https:[^)]+)\)/)?.[1];
    const weight = Number(block.match(/font-weight:\s*(\d+)/)?.[1] ?? 400) as OgFont["weight"];
    const style = (block.match(/font-style:\s*(\w+)/)?.[1] ?? "normal") as OgFont["style"];
    if (!name || !url) continue;
    const data = await fetchCached(root, url);
    out.push({ name, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, weight, style });
  }
  return out;
}

async function fontsFor(root: string, mod: OgModule): Promise<SatoriFont[]> {
  if (mod.fonts?.length) {
    return Promise.all(
      mod.fonts.map(async (f) => {
        const b = f.src.startsWith("https://") ? await fetchCached(root, f.src) : readFileSync(isAbsolute(f.src) ? f.src : join(root, f.src));
        return { name: f.name, weight: f.weight, style: f.style, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
      }),
    );
  }
  const key = "config";
  let p = fontCache.get(key);
  if (!p) {
    p = (async () => {
      const cfgFile = ["optz.config.ts", "optz.config.js"].map((f) => join(root, f)).find(existsSync);
      const fonts = cfgFile ? (((await import(cfgFile)).default?.fonts ?? []) as Array<{ google: string }>) : [];
      const urls = fonts.length ? fonts.map((f) => f.google) : ["https://fonts.googleapis.com/css2?family=Inter:wght@400;700"];
      return (await Promise.all(urls.map((u) => googleTtf(root, u)))).flat();
    })();
    fontCache.set(key, p);
  }
  return p;
}

export async function renderOg(root: string, mod: OgModule, props: Record<string, unknown>): Promise<Uint8Array> {
  const [{ default: satori }, { Resvg }] = await Promise.all([import("satori"), import("@resvg/resvg-js")]);
  const size = mod.size ?? { width: 1200, height: 630 };
  const svg = await satori(mod.default(props as never) as never, { ...size, fonts: await fontsFor(root, mod) });
  return new Uint8Array(new Resvg(svg, { fitTo: { mode: "width", value: size.width } }).render().asPng());
}
