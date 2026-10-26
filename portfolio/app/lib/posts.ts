// Blog posts from content/blog/*.md. Server-only: used by page loaders, which run at build
// time for static pages and are stripped from browser bundles.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

export interface PostMeta {
  slug: string;
  title: string;
  date: string;
  summary?: string;
}
export interface Post extends PostMeta {
  html: string;
}

const dir = join(import.meta.dir, "../../content/blog");

function parse(file: string): Post {
  const text = readFileSync(join(dir, file), "utf8");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta = Object.fromEntries(
    m[1].split("\n").filter(Boolean).map((l) => [l.slice(0, l.indexOf(":")).trim(), l.slice(l.indexOf(":") + 1).trim()]),
  );
  for (const k of ["title", "date"]) if (!meta[k]) throw new Error(`${file}: missing ${k}`);
  return { slug: file.replace(/\.md$/, ""), title: meta.title, date: meta.date, summary: meta.summary, html: marked.parse(text.slice(m[0].length), { async: false }) };
}

export function allPosts(): Post[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map(parse)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export const listPosts = (): PostMeta[] => allPosts().map(({ html: _html, ...meta }) => meta);
export const getPost = (slug: string) => allPosts().find((p) => p.slug === slug);
