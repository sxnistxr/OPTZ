import { defineConfig } from "optz";

// Every feature optz shares with Next.js, in one app. `bun run e2e` checks them in a browser.
export default defineConfig({
  port: 3002,
  site: { url: "https://features.example" },
  i18n: { locales: ["en", "fr"], defaultLocale: "en" },
  images: { sizes: [320, 640, 1200] },
  fonts: [{ google: "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap" }],
  draft: { secret: "dev-draft-secret" },
});
