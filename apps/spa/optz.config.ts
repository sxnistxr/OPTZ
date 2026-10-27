import { defineConfig } from "optz";

// client.mode "spa": the whole page hydrates and React's router navigates. A small app whose
// browser suite (e2e.cjs) checks what SPA navigation must keep in step with a full page load:
// head tags, <html lang>, focus and announcements, and <Script>.
export default defineConfig({
  port: 3006,
  site: { url: "https://spa.example" },
  i18n: { locales: ["en", "fr"], defaultLocale: "en", detect: false },
  client: { mode: "spa" },
});
