---
name: optz-mcp
description: Expose an optz app to AI clients (Claude, ChatGPT, Codex, Cursor, VS Code, Gemini) as a Model Context Protocol server - add tools, prompts and resources in app/mcp, configure the /mcp endpoint, authenticate it, and connect clients. Use when the user wants their optz site or app usable from an AI assistant, or asks about MCP, llms.txt or "AI integration" in an optz project.
---

# Making an optz app an MCP server

Every file in `app/mcp/` is one tool, prompt or resource, served at `/mcp` (Streamable HTTP,
stateless JSON) by the same server as the site: Bun, the compiled binary or an edge worker. Requests
go through `app/middleware.ts`, and tools can use `cookies()`, `headers()` and `after()`.

## A tool

```ts
// app/mcp/search_posts.ts   -> tool "search_posts" (the file name, unless `name` is set)
import { defineTool, ToolError } from "optz/mcp";
import { listPosts } from "$lib/posts";

export default defineTool({
  title: "Search posts",
  description: "Search blog posts by words in the title or summary. Returns slugs, titles and URLs.",
  input: {
    type: "object",
    properties: {
      q: { type: "string", description: "Words to look for", minLength: 2 },
      limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
    },
    required: ["q"],
  },
  annotations: { readOnlyHint: true },
  run: ({ q, limit }, { locals }) => {          // q: string, limit?: number (typed from `input`)
    const hits = listPosts().filter((p) => p.title.toLowerCase().includes(q.toLowerCase()));
    if (!hits.length) throw new ToolError(`Nothing matches "${q}"`);   // the model sees this message
    return { posts: hits.slice(0, limit) };      // object -> JSON text + structuredContent
  },
});
```

Rules that make tools work well with models:

- **Description first**: say what it does, what it returns and when to use it. The model only sees
  `title`, `description` and the schema.
- **Schema**: `type: "object"` with `properties` and `required`; add `description`, `enum`,
  `minimum`/`maximum`, `default`. Arguments are validated before `run` (bad calls get a readable
  error the model can fix), and defaults are filled in.
- **Annotations**: `readOnlyHint: true` for lookups; `destructiveHint: true` for deletes/overwrites;
  `openWorldHint: true` when it reaches other services. Clients use them to decide what to confirm.
- **Return** a string (text), a plain object (JSON + `structuredContent`), or a full
  `{ content: [...] }` result. Throw `ToolError` for errors the model should see; any other error
  is logged and reported as "tool X failed" in production.
- Keep results small and specific: ids, titles, URLs, a few fields. Paginate with `limit`/`cursor`.

## Prompts and resources

```ts
// app/mcp/review_post.ts
import { definePrompt } from "optz/mcp";
export default definePrompt({
  description: "Review a draft post for clarity",
  arguments: [{ name: "slug", required: true }],
  run: ({ slug }) => `Review the post ${slug} (read it with read_page) for clarity and length.`,
});

// app/mcp/post.ts: a resource template; {slug} comes in `params`
import { defineResource } from "optz/mcp";
export default defineResource({
  uri: "posts://{slug}",
  mimeType: "text/markdown",
  list: () => listPosts().map((p) => ({ uri: `posts://${p.slug}`, name: p.title })),
  read: ({ slug }) => getPost(slug)?.markdown ?? "",
});
```

Files in `app/mcp/_helpers/` (leading `_`) are ignored.

## Config (optz.config.ts)

```ts
mcp: {
  path: "/mcp",                     // default
  name: "my-site", version: "1.0.0",
  instructions: "Tools for searching and reading the docs of my-site.",   // told to the model
  pages: true,                      // default: pages as resources + search_pages/read_page tools
  allowedOrigins: [],               // browser origins besides site.url (non-browser clients send none)
},
llms: { exclude: ["/admin"] },      // /llms.txt and /llms-full.txt (default on; false turns off)
```

Setting `mcp` turns the endpoint on even with no `app/mcp` folder: a content site then gets
`search_pages` and `read_page` over its pre-rendered pages for free. `features.mcp: false` turns it off.

## Authentication

Public read-only tools need none. For anything private, check a token in middleware:

```ts
export default defineMiddleware(async (ctx, next) => {
  if (ctx.url.pathname === "/mcp") {
    const token = ctx.request.headers.get("authorization")?.replace(/^Bearer /, "");
    const user = token && (await userForToken(token));
    if (!user) return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
    ctx.locals.user = user;            // tools read it from their second argument
  }
  return next();
});
```

## Check it

```sh
bun run build && bun run start
curl -s localhost:3001/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
bunx @modelcontextprotocol/inspector   # GUI: connect to http://localhost:3001/mcp (Streamable HTTP)
```

`optz build` loads every `app/mcp` file and fails on a bad definition, and prints the counts.

## Connect clients (URL = https://your-site/mcp)

- Claude Code: `claude mcp add --transport http my-site https://your-site/mcp`
- Claude (web/desktop): Settings → Connectors → Add custom connector → the URL
- ChatGPT: Settings → Apps → Advanced → Developer mode, then Create app with the URL
- Codex: `codex mcp add my-site --url https://your-site/mcp`
- Cursor: `.cursor/mcp.json` → `{ "mcpServers": { "my-site": { "url": "https://your-site/mcp" } } }`
- VS Code: `.vscode/mcp.json` → `{ "servers": { "my-site": { "type": "http", "url": "https://your-site/mcp" } } }`
- Gemini CLI: `.gemini/settings.json` → `{ "mcpServers": { "my-site": { "httpUrl": "https://your-site/mcp" } } }`
