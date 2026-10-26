import type { SitemapEntry } from "optz/seo";

export default (): SitemapEntry[] => [
  { url: "/", changeFrequency: "weekly", priority: 1, alternates: { fr: "/fr" } },
  { url: "/docs", lastModified: "2026-10-01" },
];
