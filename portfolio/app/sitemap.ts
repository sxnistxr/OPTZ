import type { SitemapEntry } from "optz/seo";
import { listPosts } from "$lib/posts";

export default (): SitemapEntry[] => [
  { url: "/", changeFrequency: "weekly", priority: 1 },
  { url: "/blog", changeFrequency: "weekly" },
  { url: "/social", changeFrequency: "always" },
  ...listPosts().map((p) => ({ url: `/blog/${p.slug}`, lastModified: p.date })),
];
