# optz with AI

Connect AI clients to an optz site over MCP, give your app its own MCP tools, and set up coding
agents to work on an optz project.

It covers Claude, ChatGPT, Codex, Cursor, VS Code, Windsurf, Gemini CLI and any other client that
speaks the Model Context Protocol (MCP).

There are two separate integrations:

| | what it is | who uses it | where |
|---|---|---|---|
| **Your app as an MCP server** | `/mcp` on the running site: tools, prompts and resources from `app/mcp`, plus the site's pages | your visitors' AI assistants (Claude, ChatGPT, ...) | production, over HTTPS |
| **optz for coding agents** | `optz mcp` (project tools over stdio), `AGENTS.md`, agent skills | the agent writing your code (Claude Code, Codex, Cursor, ...) | your machine |

## Try it: connect this site

dihlabs.lol is an optz app with MCP turned on. Its endpoint is:

```
https://dihlabs.lol/mcp
```

It has `search_pages` and `read_page` for every docs page and post, `lab_experiments` for the lab,
and a `build_with_optz` prompt. Add it to your client, then ask something like *"How do Server
Actions work in optz? Cite the docs."*

| client | how to add `https://dihlabs.lol/mcp` |
|---|---|
| **Claude** (claude.ai, desktop, mobile) | Settings → Connectors → *Add custom connector* → paste the URL |
| **Claude Code** | `claude mcp add --transport http dihlabs https://dihlabs.lol/mcp` |
| **ChatGPT** | Settings → Apps → Advanced settings → turn on *Developer mode*, then *Create app* with the URL (no authentication) |
| **Codex** (CLI, IDE, app) | `codex mcp add dihlabs --url https://dihlabs.lol/mcp`, or in `~/.codex/config.toml`: `[mcp_servers.dihlabs]` + `url = "https://dihlabs.lol/mcp"` |
| **Cursor** | `.cursor/mcp.json`: `{ "mcpServers": { "dihlabs": { "url": "https://dihlabs.lol/mcp" } } }` |
| **VS Code** (Copilot agent mode) | `.vscode/mcp.json`: `{ "servers": { "dihlabs": { "type": "http", "url": "https://dihlabs.lol/mcp" } } }` |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json`: `{ "mcpServers": { "dihlabs": { "serverUrl": "https://dihlabs.lol/mcp" } } }` |
| **Gemini CLI** | `.gemini/settings.json`: `{ "mcpServers": { "dihlabs": { "httpUrl": "https://dihlabs.lol/mcp" } } }` |
| **Anything else** | Streamable HTTP transport, no authentication. Inspect it with `npx @modelcontextprotocol/inspector` |

Client menus move around; if a step above doesn't match, look for "connectors", "MCP servers",
"apps" or "tools" in the client's settings.

Prefer plain text? The same content is at [/llms.txt](https://dihlabs.lol/llms.txt) (an index
of every page) and [/llms-full.txt](https://dihlabs.lol/llms-full.txt) (every page in one file),
which you can paste into any chat.

### From code: the Claude API and OpenAI API

Both APIs can call a remote MCP server for you during a request.

Claude (Messages API, MCP connector beta): name the server in `mcp_servers` and enable its tools
with an `mcp_toolset`:

```sh
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: mcp-client-2025-11-20" \
  -H "content-type: application/json" \
  -d '{
    "model": "claude-opus-5-5",
    "max_tokens": 16000,
    "mcp_servers": [{ "type": "url", "url": "https://dihlabs.lol/mcp", "name": "dihlabs" }],
    "tools": [{ "type": "mcp_toolset", "mcp_server_name": "dihlabs" }],
    "messages": [{ "role": "user", "content": "What render modes does optz have? Cite the docs." }]
  }'
```

OpenAI (Responses API): add an `mcp` tool:

```json
{
  "model": "gpt-5",
  "tools": [{ "type": "mcp", "server_label": "dihlabs", "server_url": "https://dihlabs.lol/mcp", "require_approval": "never" }],
  "input": "What render modes does optz have? Cite the docs."
}
```

## Make your app an MCP server

Every file in `app/mcp` is one tool, prompt or resource; the file name is its name. optz serves
them at `/mcp` from the same process as the site, on every deploy target (Bun, the single
executable, edge workers).

```ts
// app/mcp/search_products.ts
import { defineTool, ToolError } from "optz/mcp";
import { products } from "$lib/catalog";

export default defineTool({
  title: "Search products",
  description: "Search the catalog by name. Returns id, name, price and URL. Use it before answering any question about what's for sale.",
  input: {
    type: "object",
    properties: {
      q: { type: "string", minLength: 2, description: "Words in the product name" },
      maxPrice: { type: "number", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 20, default: 5 },
    },
    required: ["q"],
  },
  annotations: { readOnlyHint: true },
  // q: string, maxPrice?: number, limit?: number: typed from `input`
  run: ({ q, maxPrice, limit }) => {
    const hits = products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()) && (maxPrice === undefined || p.price <= maxPrice));
    if (!hits.length) throw new ToolError(`No product matches "${q}".`);
    return { products: hits.slice(0, limit).map((p) => ({ id: p.id, name: p.name, price: p.price, url: `https://shop.example/p/${p.id}` })) };
  },
});
```

What optz does for you:

- **Validation.** Arguments are checked against `input` (types, `required`, `enum`, lengths,
  ranges, `pattern`) and defaults are filled in before `run`. A bad call returns an error the
  model can read and fix.
- **Results.** Return a string (text), an object (JSON text plus `structuredContent`), or a full
  `{ content: [...] }` result. Throw `ToolError` for messages the model should see; other errors
  are logged and reported as "tool X failed" in production, so internals don't leak.
- **Context.** Requests go through `app/middleware.ts`. Tools get `{ request, url, locals }` and
  can call `cookies()`, `headers()` and `after()` from `optz/server`.
- **Pages for free.** With `mcp.pages` (the default), the pre-rendered pages are MCP resources and
  `search_pages` / `read_page` tools read them, so a content site needs no code at all. Each page
  is checked against your middleware with the caller's cookies and `Authorization` header, so
  pages it protects stay protected.
- **Checked at build.** `optz build` loads every `app/mcp` file, fails on a bad definition, and
  prints the counts: `MCP 1 tool, 1 prompt`.

Prompts and resources work the same way:

```ts
// app/mcp/compare.ts: a prompt the user picks in their client
import { definePrompt } from "optz/mcp";
export default definePrompt({
  description: "Compare two products",
  arguments: [{ name: "a", required: true }, { name: "b", required: true }],
  run: ({ a, b }) => `Look up ${a} and ${b} with search_products and compare them in a table.`,
});

// app/mcp/product.ts: a resource template, product://{id}
import { defineResource } from "optz/mcp";
export default defineResource({
  uri: "product://{id}",
  mimeType: "application/json",
  read: ({ id }) => products.find((p) => p.id === id) ?? {},
});
```

### Config

```ts
// optz.config.ts
mcp: {
  path: "/mcp",                 // default
  name: "shop",                 // default: site.url's host name
  instructions: "Tools for the Example Shop catalog. Search before answering.",
  pages: true,                  // default
  allowedOrigins: [],           // extra browser origins; site.url's is always allowed
},
llms: { exclude: ["/account"] }, // /llms.txt and /llms-full.txt (false turns them off)
```

Setting `mcp` turns the endpoint on even without an `app/mcp` folder; that's how this site
works. `features.mcp: false` turns it off. The MCP code isn't loaded until the first request to
`/mcp`.

### Authentication

Read-only public tools need nothing. For private data, require a token in middleware and pass
the user to tools through `locals`:

```ts
// app/middleware.ts
export default defineMiddleware(async (ctx, next) => {
  if (ctx.url.pathname === "/mcp") {
    const token = ctx.request.headers.get("authorization")?.replace(/^Bearer /, "");
    const user = token ? await userForToken(token) : null;
    if (!user) return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
    ctx.locals.user = user;
  }
  return next();
});
```

Clients that take a header (Claude Code `--header`, Codex `bearer_token_env_var`, Cursor and VS
Code `headers`) can send the token. Browser-based clients that need OAuth sign-in (claude.ai,
ChatGPT) need an OAuth authorization server in front.

### How it's served

- Streamable HTTP, **stateless**: each `POST /mcp` carries one JSON-RPC message (or a batch) and
  gets JSON back; no sessions and no event stream. That's what lets the endpoint run in an edge
  worker or behind any load balancer.
- Protocol versions `2025-11-25`, `2025-06-18`, `2025-03-26` and `2024-11-05`.
- An `Origin` header must be `site.url`'s origin (or in `mcp.allowedOrigins`), which stops web
  pages from reaching a local server through DNS rebinding. Non-browser clients send no `Origin`.
- `GET /mcp` answers 405, which tells clients there's no server-to-client stream.

Check it by hand:

```sh
curl -s https://dihlabs.lol/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_pages","arguments":{"query":"islands"}}}'
```

## Coding agents on an optz project

`optz create` sets this up for new apps; in an existing one run:

```sh
bunx optz agents                         # or --only claude,codex,cursor,vscode,gemini
```

It writes:

| file | read by |
|---|---|
| `AGENTS.md` (an optz section; your own text is kept) | Codex, Cursor, VS Code Copilot, Gemini CLI, Windsurf, Zed, Jules and most others |
| `CLAUDE.md` with `@AGENTS.md` | Claude Code |
| `.claude/skills/optz`, `.claude/skills/optz-mcp` | Claude Code skills |
| `.agents/skills/optz`, `.agents/skills/optz-mcp` | Codex skills (and other Agent Skills clients) |
| `.mcp.json` | Claude Code (project MCP servers) |
| `.codex/config.toml` | Codex (trusted projects) |
| `.cursor/mcp.json`, `.vscode/mcp.json`, `.gemini/settings.json` | Cursor, VS Code, Gemini CLI |

Each MCP config starts `bunx optz mcp`, an MCP server over stdio with tools for the project:

| tool | what it does |
|---|---|
| `optz_project` | pages with render modes, loaders and ISR, API routes and methods, Server Actions, islands, MCP tools, middleware, config |
| `optz_match_url` | which file answers a URL, with params, layouts, error and loading files |
| `optz_docs` | the framework reference, by section |
| `optz_scaffold` | a new page, dynamic page, API route, island, action, MCP tool or prompt, layout or middleware (never overwrites) |
| `optz_check` | `optz check`: route types and the type-check |
| `optz_build` | `optz build` (pre-renders static pages, so loader errors show up) |
| `optz_fetch` | a request to the running dev server, HTML as readable text |

It also has two prompts, `optz_add_feature` and `optz_expose_to_ai`, and the skills as resources.
The skills teach the agent optz's conventions (it isn't Next.js: no `"use client"`, islands
instead), the cheapest render mode for each page, and "done means `optz check` and `optz build`
pass".

Re-run `optz agents` after upgrading optz: it updates its own parts and leaves the rest of each
file alone.

To use the skills in every project, copy them into your user folder:

```sh
cp -r node_modules/optz/skills/* ~/.claude/skills/     # Claude Code
cp -r node_modules/optz/skills/* ~/.agents/skills/     # Codex
```
