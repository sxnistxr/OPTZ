// Self-hosted web fonts (config.fonts): at build time, each Google Fonts css2 URL is fetched,
// its WOFF2 files are saved into /assets with hashed names, and the @font-face rules go into
// the main stylesheet. No request to Google at runtime (faster, private, and CSP can say
// font-src 'self').
//
// Each family also gets a "<Family> Fallback" face: a local font (Arial or Times New Roman)
// scaled and given the web font's ascent, descent and line gap, read from the font file, so
// text keeps its size and position when the web font arrives. Add it to your font stack:
//   --font-serif: "Newsreader", "Newsreader Fallback", serif;
import { brotliDecompressSync } from "node:zlib";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "./types";

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

/** Reference metrics of the local fallback fonts (units per em, weighted average width). */
const LOCAL: Record<string, { upm: number; avg: number }> = {
  Arial: { upm: 2048, avg: 904 },
  "Times New Roman": { upm: 2048, avg: 819 },
  Georgia: { upm: 2048, avg: 913 },
  "Courier New": { upm: 2048, avg: 1229 },
};

// English letter frequencies (space included): what "average width" is weighted by.
const FREQ: Record<string, number> = {
  " ": 0.1818, e: 0.1039, t: 0.0741, a: 0.0668, o: 0.0614, i: 0.057, n: 0.0552, s: 0.0518, h: 0.0499, r: 0.049, d: 0.0348, l: 0.0329,
  c: 0.0228, u: 0.0226, m: 0.0197, w: 0.0193, f: 0.0182, g: 0.0165, y: 0.0162, p: 0.0158, b: 0.0122, v: 0.008, k: 0.0063, j: 0.0013,
  x: 0.0012, q: 0.0008, z: 0.0006,
};

export interface FontMetrics {
  unitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
  /** Frequency-weighted average advance width of a-z and space. */
  avgWidth: number;
}

const KNOWN_TAGS = (
  "cmap|head|hhea|hmtx|maxp|name|OS/2|post|cvt |fpgm|glyf|loca|prep|CFF |VORG|EBDT|EBLC|gasp|hdmx|kern|LTSH|PCLT|VDMX|vhea|vmtx|BASE|GDEF|GPOS|" +
  "GSUB|EBSC|JSTF|MATH|CBDT|CBLC|COLR|CPAL|SVG |sbix|acnt|avar|bdat|bloc|bsln|cvar|fdsc|feat|fmtx|fvar|gvar|hsty|just|lcar|mort|morx|opbd|prop|" +
  "trak|Zapf|Silf|Glat|Gloc|Feat|Sill"
).split("|");

/** Reads the metrics from a WOFF2 file: the table directory, then the brotli stream holding the
 *  tables, of which head, hhea, OS/2, cmap and hmtx are needed. */
export function woff2Metrics(file: Uint8Array): FontMetrics {
  const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (v.getUint32(0) !== 0x774f4632) throw new Error("not a WOFF2 file");
  const numTables = v.getUint16(12);
  let off = 48;
  const base128 = () => {
    let n = 0;
    for (let i = 0; i < 5; i++) {
      const b = v.getUint8(off++);
      n = n * 128 + (b & 0x7f);
      if (!(b & 0x80)) return n;
    }
    throw new Error("bad UIntBase128");
  };
  const tables: { tag: string; length: number; transformed: boolean }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = v.getUint8(off++);
    let tag: string;
    if ((flags & 0x3f) === 63) {
      tag = String.fromCharCode(v.getUint8(off), v.getUint8(off + 1), v.getUint8(off + 2), v.getUint8(off + 3));
      off += 4;
    } else tag = KNOWN_TAGS[flags & 0x3f];
    const version = flags >> 6;
    const orig = base128();
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    const length = transformed ? base128() : orig;
    tables.push({ tag, length, transformed });
  }
  const compressedLength = v.getUint32(20);
  const data = brotliDecompressSync(file.subarray(off, off + compressedLength));
  const at: Record<string, DataView> = {};
  let pos = 0;
  for (const t of tables) {
    if (!t.transformed) at[t.tag] = new DataView(data.buffer, data.byteOffset + pos, t.length);
    pos += t.length;
  }
  const head = at.head, hhea = at.hhea, hmtx = at.hmtx, cmap = at.cmap;
  if (!head || !hhea) throw new Error("font has no head/hhea table");
  const unitsPerEm = head.getUint16(18);
  const ascent = hhea.getInt16(4);
  const descent = hhea.getInt16(6);
  const lineGap = hhea.getInt16(8);
  const numHMetrics = hhea.getUint16(34);

  let avgWidth = at["OS/2"]?.getInt16(2) ?? unitsPerEm / 2;
  if (hmtx && cmap) {
    const glyphOf = cmapLookup(cmap);
    const adv = (g: number) => hmtx.getUint16(Math.min(g, numHMetrics - 1) * 4);
    let sum = 0,
      weight = 0;
    for (const [ch, f] of Object.entries(FREQ)) {
      const g = glyphOf(ch.charCodeAt(0));
      if (g === undefined) continue;
      sum += adv(g) * f;
      weight += f;
    }
    if (weight > 0.5) avgWidth = sum / weight;
  }
  return { unitsPerEm, ascent, descent, lineGap, avgWidth };
}

/** Code point -> glyph id, from a format 4 or 12 cmap subtable. */
function cmapLookup(cmap: DataView): (cp: number) => number | undefined {
  const n = cmap.getUint16(2);
  for (let i = 0; i < n; i++) {
    const platform = cmap.getUint16(4 + i * 8);
    const encoding = cmap.getUint16(6 + i * 8);
    const sub = cmap.getUint32(8 + i * 8);
    if (!((platform === 3 && (encoding === 1 || encoding === 10)) || platform === 0)) continue;
    const format = cmap.getUint16(sub);
    if (format === 4) {
      const segX2 = cmap.getUint16(sub + 6);
      const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
      return (cp) => {
        for (let s = 0; s < segX2 / 2; s++) {
          const end = cmap.getUint16(ends + s * 2);
          if (cp > end) continue;
          const start = cmap.getUint16(starts + s * 2);
          if (cp < start) return undefined;
          const delta = cmap.getInt16(deltas + s * 2);
          const ro = cmap.getUint16(ranges + s * 2);
          if (!ro) return (cp + delta) & 0xffff;
          const g = cmap.getUint16(ranges + s * 2 + ro + (cp - start) * 2);
          return g ? (g + delta) & 0xffff : undefined;
        }
        return undefined;
      };
    }
    if (format === 12) {
      const groups = cmap.getUint32(sub + 12);
      return (cp) => {
        for (let gI = 0; gI < groups; gI++) {
          const o = sub + 16 + gI * 12;
          const start = cmap.getUint32(o), end = cmap.getUint32(o + 4);
          if (cp >= start && cp <= end) return cmap.getUint32(o + 8) + (cp - start);
        }
        return undefined;
      };
    }
  }
  return () => undefined;
}

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

/** The @font-face rule of a size-matched local fallback. */
export function fallbackFace(family: string, m: FontMetrics, local = "Arial"): string {
  const ref = LOCAL[local] ?? LOCAL.Arial;
  const sizeAdjust = m.avgWidth / m.unitsPerEm / (ref.avg / ref.upm);
  const em = m.unitsPerEm * sizeAdjust;
  return `@font-face{font-family:"${family} Fallback";src:local("${local}");ascent-override:${pct(m.ascent / em)};descent-override:${pct(Math.abs(m.descent) / em)};line-gap-override:${pct(m.lineGap / em)};size-adjust:${pct(sizeAdjust)}}`;
}

export async function buildFonts(fonts: NonNullable<Config["fonts"]>, assetsDir: string): Promise<{ css: string; preload: string[] }> {
  let css = "";
  const preload: string[] = [];
  const downloaded = new Map<string, Uint8Array>();
  for (const font of fonts) {
    const res = await fetch(font.google, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`fonts: ${font.google} answered ${res.status}`);
    const sheet = await res.text();
    const want = new Set(font.preload ?? ["latin"]);
    const metricsFor = new Map<string, FontMetrics>();
    // Google's CSS: "/* latin */\n@font-face { font-family: 'X'; ... src: url(...) format('woff2'); ... }"
    for (const m of sheet.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*{([^}]*)}/g)) {
      const [, subset, body] = m;
      const url = body.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
      const family = body.match(/font-family:\s*'([^']+)'/)?.[1];
      if (!url || !family) continue;
      // Variable fonts: several weights share one file.
      let bytes = downloaded.get(url);
      if (!bytes) {
        const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error(`fonts: ${url} answered ${r.status}`);
        bytes = new Uint8Array(await r.arrayBuffer());
        downloaded.set(url, bytes);
      }
      const name = `${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${subset}-${createHash("sha256").update(bytes).digest("hex").slice(0, 10)}.woff2`;
      writeFileSync(join(assetsDir, name), bytes);
      const local = `/assets/${name}`;
      css += `@font-face{${body.replace(url, local).replace(/\s*\n\s*/g, "").replace(/;\s*$/, "")}}\n`;
      const weight = body.match(/font-weight:\s*([\d ]+);/)?.[1].trim() ?? "400";
      const italic = /font-style:\s*italic/.test(body);
      if (want.has(subset) && !preload.includes(local) && !italic) preload.push(local);
      if (subset === "latin" && (!metricsFor.has(family) || (weight.startsWith("400") && !italic))) {
        try {
          metricsFor.set(family, woff2Metrics(bytes));
        } catch (e) {
          console.warn(`optz: couldn't read metrics of ${family}: ${(e as Error).message}`);
        }
      }
    }
    for (const [family, m] of metricsFor) css += fallbackFace(family, m, font.fallback) + "\n";
  }
  return { css, preload };
}
