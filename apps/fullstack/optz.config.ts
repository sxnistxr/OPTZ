import { defineConfig } from "optz";
export default defineConfig({
  port: 3007,
  client: { mode: "islands", runtime: "preact", speculation: false },
  features: { actions: false, images: false, mcp: false },
  server: { maxRequestBodySize: 6 << 20 },
});
