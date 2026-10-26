import type { NextConfig } from "next";

const config: NextConfig = {
  typedRoutes: true,
  poweredByHeader: false,
  // The Rust engine answers the social feed, as in optz.config.ts's proxy.
  rewrites: async () => [{ source: "/api/social/:path*", destination: "http://127.0.0.1:3000/:path*" }],
};
export default config;
