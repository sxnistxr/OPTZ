import type { SitemapEntry } from "optz/seo";
import { listDocs } from "$lib/docs";
import { listPosts } from "$lib/posts";

export default (): SitemapEntry[] => [
  { url: "/", changeFrequency: "weekly", priority: 1 },
  { url: "/lab", changeFrequency: "weekly" },
  { url: "/blog", changeFrequency: "weekly" },
  { url: "/docs", changeFrequency: "weekly" },
  ...listPosts().map((p) => ({ url: `/blog/${p.slug}`, lastModified: p.date })),
  ...listDocs().map((d) => ({ url: `/docs/${d.slug}` })),
];
