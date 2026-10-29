import { defineConfig } from "optz";
export default defineConfig({
  port: 3008, client: { mode: "islands", runtime: "preact", speculation: false },
  features: { actions: false, images: false, mcp: false },
  server: { maxRequestBodySize: 128 << 10 },
});
