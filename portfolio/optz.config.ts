// Everything about how the portfolio is served. Hover any option for its docs.
import { defineConfig } from "optz";

export default defineConfig({
  port: 3001,

  // The Rust engine (engine/) answers the social feed. `optz nginx` turns this into an nginx
  // location, so in production these requests never touch Bun.
  // cacheSeconds: nginx serves GETs from a 1 s micro-cache, so a traffic spike reaches the engine
  // at most once a second per URL (measured: 61k req/s from nginx for /api/social/feed).
  // Writes (POST) and anything with a token always go straight through.
  proxy: {
    "/api/social": { target: "http://127.0.0.1:3000", strip: true, cacheSeconds: 1 },
  },

  client: {
    mode: "islands", // pages are HTML; only *.island.tsx components ship JS
    navigation: true, // swap page HTML on link clicks (~2 KB)
    prefetch: true, // fetch pages on hover/focus/touch
    runtime: "preact", // islands hydrate with Preact (~4 KB) instead of React (~60 KB)
  },

  features: {
    middleware: true, // security headers in app/middleware.ts
    dynamic: false, // no per-request React rendering: every page is static or client-rendered
    api: true, // app/api routes
    cache: true, // in-memory response cache for API routes
    dynamicCompression: true,
    etag: true,
    requestLog: false,
  },

  cache: { maxEntries: 200, maxBytes: 8 << 20 },

  server: { idleTimeout: 30, maxRequestBodySize: 64 * 1024 },

  head: {
    links: [
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Schibsted+Grotesk:wght@400;500;600;700&display=swap",
      },
    ],
  },
});
