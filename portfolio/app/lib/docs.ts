// The documentation: Markdown files from anywhere in the repository (content/docs/index.json
// lists them by section), rendered at build time. Headings get ids and anchors, links to other
// docs pages become /docs/<slug>, links to other repository files go to GitHub.
// Server-only: used by loaders and the prerendered /api/docs index.
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { Marked, type Tokens } from "marked";
import { htmlText } from "optz/mcp";
import sections from "$content/docs/index.json";
import site from "./site";

const repoRoot = join(import.meta.dir, "../../..");

export interface DocMeta {
  slug: string;
  title: string;
  section: string;
  description: string;
  /** Path in the repository, e.g. "framework/README.md". */
  file: string;
}
export interface TocEntry {
  id: string;
  text: string;
  depth: number;
}
export interface Doc extends DocMeta {
  html: string;
  toc: TocEntry[];
  prev?: DocMeta;
  next?: DocMeta;
}

interface Entry {
  slug: string;
  file: string;
  title?: string;
  /** Overrides the first paragraph as the page's description. */
  description?: string;
}

const entries = (sections as { section: string; pages: Entry[] }[]).flatMap((s) => s.pages.map((p) => ({ ...p, section: s.section })));
const bySlug = new Map(entries.map((e) => [e.slug, e]));
const byFile = new Map(entries.map((e) => [e.file, e]));

export const slugify = (s: string) =>
  htmlText(s, false)
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-");

const plain = (md: string) =>
  md
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

function source(e: Entry): { title: string; body: string; description: string } {
  const text = readFileSync(join(repoRoot, e.file), "utf8");
  const h1 = text.match(/^# (.+)$/m);
  const body = h1 ? text.replace(h1[0], "") : text;
  // The first real paragraph, as the page description.
  const para = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^(#|\||```|[-*] |>|<|\d+\.)/.test(p));
  const description = para ? plain(para) : "";
  const short = description.length > 180 ? description.slice(0, 177).replace(/\s+\S*$/, "").replace(/[.,;:]+$/, "") + "…" : description;
  // A short first paragraph becomes the page's lead, so it isn't repeated in the body.
  const lead = !e.description && para && para.length <= 180 && body.trimStart().startsWith(para);
  return { title: e.title ?? (h1 ? plain(h1[1]) : e.slug), body: lead ? body.trimStart().slice(para.length) : body, description: e.description ?? short };
}

/** Where a link in `file` should point on the site. */
export function resolveLink(file: string, href: string): string {
  if (/^([a-z]+:|#|\/)/i.test(href)) return href;
  const [path, hash] = href.split("#");
  const target = posix.normalize(posix.join(posix.dirname(file), path)).replace(/\/$/, "");
  const doc = byFile.get(target);
  if (doc) return `/docs/${doc.slug}${hash ? `#${hash}` : ""}`;
  const kind = existsSync(join(repoRoot, target)) && !/\.\w+$/.test(target) ? "tree" : "blob";
  return `${site.repo}/${kind}/${site.branch}/${target}${hash ? `#${hash}` : ""}`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function render(e: Entry, body: string): { html: string; toc: TocEntry[] } {
  const toc: TocEntry[] = [];
  const used = new Map<string, number>();
  const md = new Marked({ gfm: true });
  md.use({
    renderer: {
      heading(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, t: Tokens.Heading) {
        const inner = this.parser.parseInline(t.tokens);
        let id = slugify(inner) || "section";
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        if (t.depth <= 3) toc.push({ id, text: plain(htmlText(inner, false)), depth: t.depth });
        return `<h${t.depth} id="${id}"><a class="anchor" href="#${id}">${inner}</a></h${t.depth}>\n`;
      },
      link(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, t: Tokens.Link) {
        const href = resolveLink(e.file, t.href);
        const external = /^https?:/.test(href);
        return `<a href="${esc(href)}"${t.title ? ` title="${esc(t.title)}"` : ""}${external ? ' rel="noopener"' : ""}>${this.parser.parseInline(t.tokens)}</a>`;
      },
      code(t: Tokens.Code) {
        const lang = (t.lang ?? "").split(/\s/)[0];
        return `<pre${lang ? ` data-lang="${esc(lang)}"` : ""}><code>${esc(t.text)}</code></pre>\n`;
      },
      table(this: { parser: { parseInline(t: Tokens.Generic[]): string } }, t: Tokens.Table) {
        const cell = (c: Tokens.TableCell, tag: "th" | "td", i: number) => {
          const align = t.align[i];
          return `<${tag}${align ? ` data-align="${align}"` : ""}>${this.parser.parseInline(c.tokens)}</${tag}>`;
        };
        const head = `<tr>${t.header.map((c, i) => cell(c, "th", i)).join("")}</tr>`;
        const rows = t.rows.map((r) => `<tr>${r.map((c, i) => cell(c, "td", i)).join("")}</tr>`).join("");
        // Wide tables scroll inside their own box instead of the page.
        return `<div class="table-scroll"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>\n`;
      },
    },
  });
  return { html: md.parse(body, { async: false }) as string, toc };
}

export function docSections(): { section: string; pages: DocMeta[] }[] {
  return (sections as { section: string; pages: Entry[] }[]).map((s) => ({
    section: s.section,
    pages: s.pages.map((p) => meta({ ...p, section: s.section })),
  }));
}

function meta(e: Entry & { section: string }): DocMeta {
  const { title, description } = source(e);
  return { slug: e.slug, title, section: e.section, description, file: e.file };
}

export const listDocs = (): DocMeta[] => entries.map(meta);

export function getDoc(slug: string): Doc | undefined {
  const e = bySlug.get(slug);
  if (!e) return undefined;
  const { title, body, description } = source(e);
  const { html, toc } = render(e, body);
  const all = listDocs();
  const i = all.findIndex((d) => d.slug === slug);
  return { slug, title, section: e.section, description, file: e.file, html, toc, prev: all[i - 1], next: all[i + 1] };
}

/** What the search box searches: titles, sections, descriptions and headings. */
export function searchIndex() {
  return entries.map((e) => {
    const d = getDoc(e.slug)!;
    return { slug: d.slug, title: d.title, section: d.section, description: d.description, headings: d.toc.filter((t) => t.depth > 1).map((t) => ({ id: t.id, text: t.text })) };
  });
}
