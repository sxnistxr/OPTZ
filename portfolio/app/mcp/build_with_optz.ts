// MCP prompt: start a task that builds something with optz, grounded in these docs.
import { definePrompt } from "optz/mcp";

export default definePrompt({
  title: "Build it with optz",
  description: "Plan how to build something with the optz framework, using its documentation on this site.",
  arguments: [{ name: "idea", description: "What you want to build", required: true }],
  run: ({ idea }) =>
    `I want to build this with optz: ${idea}\n\nUse search_pages and read_page on this site's docs (start with /docs/framework and /docs/ai) to plan it: which files go in app/routes, app/api, app/mcp and *.island.tsx components, which render mode each page needs, and what to check with \`optz check\` and \`optz build\`. Quote the docs you rely on.`,
});
