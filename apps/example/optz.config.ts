import { defineConfig } from "optz";

export default defineConfig({
  port: 3001,
  // Forward a prefix to another server (your API), e.g.:
  // proxy: { "/api": { target: "http://127.0.0.1:3000", strip: true } },
});
