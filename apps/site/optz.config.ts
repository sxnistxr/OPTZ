import { defineConfig } from "optz";

export default defineConfig({
  port: 3001,
  // In production nginx sends /api straight to the Rust server; this rule is for `optz dev`
  // and for running without nginx.
  proxy: { "/api": { target: "http://127.0.0.1:3000", strip: true } },
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
