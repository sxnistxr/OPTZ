// GET /api/docs: the search index for the docs (titles, sections, headings). Built once at
// build time and served from memory.
import { json } from "optz";
import { searchIndex } from "$lib/docs";

export const prerender = true;
export const GET = () => json({ docs: searchIndex() });
