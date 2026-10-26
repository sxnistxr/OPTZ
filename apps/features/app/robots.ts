import type { Robots } from "optz/seo";

export default (): Robots => ({ rules: [{ userAgent: "*", allow: "/", disallow: "/api/" }], sitemap: "/sitemap.xml" });
