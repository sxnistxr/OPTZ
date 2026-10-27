import { definePrompt } from "optz/mcp";

export default definePrompt({
  description: "Explain one of the site's pages",
  arguments: [{ name: "path", description: "The page's path", required: true }],
  run: ({ path }) => `Read ${path} with read_page and explain it in two sentences.`,
});
