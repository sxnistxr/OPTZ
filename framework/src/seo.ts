// Metadata files built from code, like Next's:
//   app/sitemap.ts   -> /sitemap.xml          export default () => SitemapEntry[]
//   app/robots.ts    -> /robots.txt           export default () => Robots
//   app/manifest.ts  -> /manifest.webmanifest export default () => WebManifest
// Relative URLs become absolute with site.url from the config.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ResolvedConfig } from "./types";

export interface SitemapEntry {
  url: string;
  lastModified?: string | Date;
  changeFrequency?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
  /** hreflang alternates: { fr: "/fr/about" } */
  alternates?: Record<string, string>;
}

export interface Robots {
  rules: Array<{ userAgent?: string | string[]; allow?: string | string[]; disallow?: string | string[]; crawlDelay?: number }>;
  sitemap?: string | string[];
  host?: string;
}

export interface WebManifest {
  name: string;
  short_name?: string;
  description?: string;
  start_url?: string;
  display?: "standalone" | "fullscreen" | "minimal-ui" | "browser";
  background_color?: string;
  theme_color?: string;
  icons?: Array<{ src: string; sizes?: string; type?: string; purpose?: string }>;
  [key: string]: unknown;
}

const xml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const list = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function sitemapXml(entries: SitemapEntry[], base?: string): string {
  const abs = (u: string) => (base ? new URL(u, base).href : u);
  const hasAlt = entries.some((e) => e.alternates);
  const items = entries.map((e) => {
    const lm = e.lastModified ? (e.lastModified instanceof Date ? e.lastModified : new Date(e.lastModified)).toISOString() : undefined;
    return [
      "<url>",
      `<loc>${xml(abs(e.url))}</loc>`,
      lm && `<lastmod>${lm}</lastmod>`,
      e.changeFrequency && `<changefreq>${e.changeFrequency}</changefreq>`,
      e.priority !== undefined && `<priority>${e.priority}</priority>`,
      ...Object.entries(e.alternates ?? {}).map(([l, u]) => `<xhtml:link rel="alternate" hreflang="${xml(l)}" href="${xml(abs(u))}"/>`),
      "</url>",
    ]
      .filter(Boolean)
      .join("");
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${hasAlt ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ""}>\n${items.join("\n")}\n</urlset>\n`;
}

export function robotsTxt(r: Robots, base?: string): string {
  const abs = (u: string) => (base ? new URL(u, base).href : u);
  const out: string[] = [];
  for (const rule of r.rules) {
    for (const ua of list(rule.userAgent ?? "*")) out.push(`User-Agent: ${ua}`);
    for (const a of list(rule.allow)) out.push(`Allow: ${a}`);
    for (const d of list(rule.disallow)) out.push(`Disallow: ${d}`);
    if (rule.crawlDelay) out.push(`Crawl-delay: ${rule.crawlDelay}`);
    out.push("");
  }
  if (r.host) out.push(`Host: ${r.host}`);
  for (const s of list(r.sitemap)) out.push(`Sitemap: ${abs(s)}`);
  return out.join("\n").trim() + "\n";
}

/** Writes the files whose source exists. Returns how many. */
export async function buildSeoFiles(root: string, config: ResolvedConfig, staticDir: string): Promise<number> {
  const base = config.site?.url;
  const find = (name: string) => ["ts", "tsx", "js"].map((e) => join(root, `app/${name}.${e}`)).find(existsSync);
  const out = (file: string, content: string) => {
    mkdirSync(dirname(join(staticDir, file)), { recursive: true });
    writeFileSync(join(staticDir, file), content);
  };
  let n = 0;
  const sm = find("sitemap");
  if (sm) {
    out("sitemap.xml", sitemapXml(await (await import(sm)).default(), base));
    n++;
  }
  const rb = find("robots");
  if (rb) {
    out("robots.txt", robotsTxt(await (await import(rb)).default(), base));
    n++;
  }
  const mf = find("manifest");
  if (mf) {
    out("manifest.webmanifest", JSON.stringify(await (await import(mf)).default(), null, 2));
    n++;
  }
  return n;
}
