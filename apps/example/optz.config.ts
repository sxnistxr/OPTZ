import { defineConfig } from "optz";

// Every option is optional; hover one in your editor for its docs.
export default defineConfig({
  port: 3001,
  // Forward a prefix to another server (your API), e.g.:
  // proxy: { "/api/backend": { target: "http://127.0.0.1:3000", strip: true } },
  client: {
    mode: "islands", // pages are HTML; only *.island.tsx components ship JS ("spa" hydrates everything)
    navigation: true, // swap pages without full reloads (~2 KB)
    prefetch: true,
    runtime: "react", // "preact": islands ship ~4 KB instead of ~60 KB, same React API
  },
  features: {
    middleware: true,
    dynamic: true, // per-request rendering; off = React's server renderer never loads at runtime
    api: true,
    cache: true,
  },
  cache: { maxEntries: 500, maxBytes: 32 << 20 },
  server: { idleTimeout: 30, maxRequestBodySize: 1 << 20 },
});
