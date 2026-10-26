// Everything about how dihlabs.lol is served. Hover any option for its docs.
import { defineConfig } from "optz";
import site from "./content/site.json";

export default defineConfig({
  port: 3001,
  // Absolute URLs for Open Graph images, canonical links and the sitemap.
  site: { url: process.env.SITE_URL ?? site.url },

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

  // Downloaded at build time and served from /assets: no request to Google from visitors, and
  // size-matched fallbacks ("Newsreader Fallback") so text doesn't shift when they load.
  fonts: [
    { google: "https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&display=swap" },
    { google: "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap", fallback: "Times New Roman", preload: [] },
  ],

  head: {
    links: [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
  },
});
