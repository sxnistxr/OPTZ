// MCP tool: what's in the lab. AI clients connected to https://dihlabs.lol/mcp can call it; the
// docs and blog are covered by the built-in search_pages and read_page tools.
import { defineTool } from "optz/mcp";
import lab from "$lib/lab";

export default defineTool({
  title: "Lab experiments",
  description: "List the experiments in the dihlabs.lol lab (diffusion models, LLMs, fast software on small machines), optionally only one status. Returns name, area, status, summary and a link.",
  input: {
    type: "object",
    properties: { status: { type: "string", enum: ["exploring", "shipped", "paused"], description: "Only experiments with this status" } },
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  run: ({ status }) => ({
    experiments: lab
      .filter((e) => !status || e.status === status)
      .map((e) => ({ name: e.name, area: e.area, status: e.status, summary: e.summary, url: e.href ?? `https://dihlabs.lol/lab#${e.slug}` })),
  }),
});
