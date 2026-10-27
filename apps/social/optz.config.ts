import { defineConfig } from "optz";

// The social feed that used to live on the site: islands over the Rust engine (portfolio/engine).
export default defineConfig({
  port: 3005,
  proxy: { "/api/social": { target: process.env.ENGINE_URL ?? "http://127.0.0.1:3000", strip: true, cacheSeconds: 1, bypassMiddleware: true } },
  client: { mode: "islands", runtime: "preact" },
  features: { dynamic: false },
  head: { links: [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }] },
});
