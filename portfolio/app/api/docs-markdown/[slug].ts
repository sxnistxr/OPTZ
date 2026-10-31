// GET /api/docs-markdown/<slug>: a docs page's Markdown source, for "Copy page" and language models.
// Written once at build time and served from memory.
import type { ApiContext } from "optz";
import { docMarkdown, listDocs } from "$lib/docs";

export const prerender = true;
export const paths = () => listDocs().map((d) => ({ slug: d.slug }));
export const GET = ({ params }: ApiContext<{ slug: string }>) => {
  const markdown = docMarkdown(params.slug);
  return markdown === undefined
    ? new Response("Not found", { status: 404 })
    : new Response(markdown, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
};
