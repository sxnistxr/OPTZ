// MCP and coding agents: the protocol pieces, llms.txt, `optz agents` and `optz mcp` (stdio).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentFiles, writeAgentFiles } from "../src/agents";
import { llmsTxt } from "../src/llms";
import { createMcpServer, defineTool, mcpName, pageText, toolResult, validate, type Infer } from "../src/mcp";
import { resolveConfig } from "../src/types";

describe("MCP pieces", () => {
  test("schemas type and validate arguments", () => {
    const s = { type: "object", properties: { q: { type: "string", minLength: 2 }, n: { type: "integer", maximum: 5 }, kind: { enum: ["a", "b"] } }, required: ["q"], additionalProperties: false } as const;
    const ok: Infer<typeof s> = { q: "hi", kind: "a" };
    expect(validate(s, ok)).toBeNull();
    expect(validate(s, {})).toBe("arguments.q is required");
    expect(validate(s, { q: "x" })).toBe("arguments.q must be at least 2 characters");
    expect(validate(s, { q: "xy", n: 1.5 })).toBe("arguments.n must be an integer");
    expect(validate(s, { q: "xy", n: 9 })).toBe("arguments.n must be <= 5");
    expect(validate(s, { q: "xy", kind: "c" })).toBe('arguments.kind must be one of "a", "b"');
    expect(validate(s, { q: "xy", extra: 1 })).toBe("arguments.extra is not a known argument");
  });

  test("names, results and page text", () => {
    expect(mcpName("app/mcp/posts/search.ts")).toBe("posts_search");
    expect(mcpName("app/mcp/stats/index.ts")).toBe("stats");
    expect(toolResult("hi")).toEqual({ content: [{ type: "text", text: "hi" }] });
    expect(toolResult({ a: 1 }).structuredContent).toEqual({ a: 1 });
    expect(toolResult([1]).structuredContent).toBeUndefined();
    const p = pageText(
      '<title>Docs &amp; more</title><meta name="description" content="All of it"><body><nav>skip</nav><main><h1>Hello</h1><p>Read <a href="/x">the <b>guide</b></a>.</p><ul><li>one</li></ul><script>x()</script></main></body>',
    );
    expect(p).toEqual({ title: "Docs & more", description: "All of it", text: "# Hello\n\nRead [the guide](/x).\n\n- one" });
  });

  test("a bad module fails loudly; tool errors stay out of production responses", async () => {
    const config = resolveConfig({});
    expect(() => createMcpServer({ config, modules: [{ file: "app/mcp/x.ts", mod: { default: {} } }] })).toThrow(/must `export default` defineTool/);
    const boom = defineTool({ description: "fails", run: () => { throw new Error("secret detail"); } });
    const s = createMcpServer({ config, modules: [{ file: "app/mcp/boom.ts", mod: { default: boom } }] });
    const url = new URL("http://localhost/mcp");
    const err = console.error;
    console.error = () => {};
    const r = (await s.message({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "boom" } }, { request: new Request(url), url, locals: {} })) as { result: { isError: boolean; content: { type: string; text: string }[] } };
    console.error = err;
    expect(r.result).toEqual({ isError: true, content: [{ type: "text", text: "tool boom failed" }] });
  });

  test("pages the app's middleware protects stay hidden over MCP", async () => {
    const pages = [
      { path: "/docs", title: "Docs", description: "", text: "public guide" },
      { path: "/admin", title: "Admin", description: "", text: "secret guide" },
    ];
    const s = createMcpServer({ config: resolveConfig({ mcp: {} }), modules: [], pages: () => pages, canRead: async (p, c) => p !== "/admin" || c.request.headers.get("authorization") === "Bearer ok" });
    const call = async (auth: string, name: string, args: unknown) => {
      const url = new URL("http://localhost/mcp");
      const r = (await s.message({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, { request: new Request(url, { headers: { authorization: auth } }), url, locals: {} })) as { result: any };
      return r.result;
    };
    expect((await call("", "search_pages", { query: "guide" })).structuredContent.results.map((r: { path: string }) => r.path)).toEqual(["/docs"]);
    expect((await call("", "read_page", { path: "/admin" })).isError).toBe(true);
    expect((await call("Bearer ok", "search_pages", { query: "guide" })).structuredContent.results).toHaveLength(2);
  });

  test("llms.txt groups pages by section", () => {
    const pages = [
      { path: "/", title: "Home", description: "A site", text: "" },
      { path: "/about", title: "About", description: "", text: "" },
      { path: "/docs/a", title: "A", description: "First", text: "" },
    ];
    expect(llmsTxt(pages, { base: "https://x.dev", mcpUrl: "https://x.dev/mcp" })).toBe(
      "# Home\n\n> A site\n\nThis site is also an MCP server: https://x.dev/mcp (Streamable HTTP). Connect an AI client to search and read it.\n\n## Pages\n\n- [Home](https://x.dev/): A site\n- [About](https://x.dev/about)\n\n## Docs\n\n- [A](https://x.dev/docs/a): First\n",
    );
  });
});

describe("coding agents", () => {
  test("optz agents writes AGENTS.md, skills and MCP configs, and keeps what's there", () => {
    const dir = mkdtempSync(join(tmpdir(), "optz-agents-"));
    writeFileSync(join(dir, "AGENTS.md"), "# Mine\n\nKeep this.\n");
    writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    expect(writeAgentFiles(dir, undefined, true).sort()).toEqual(
      [".agents/skills/optz-mcp/SKILL.md", ".agents/skills/optz/SKILL.md", ".claude/skills/optz-mcp/SKILL.md", ".claude/skills/optz/SKILL.md", ".codex/config.toml", ".cursor/mcp.json", ".gemini/settings.json", ".mcp.json", ".vscode/mcp.json", "AGENTS.md", "CLAUDE.md"].sort(),
    );
    const agents = readFileSync(join(dir, "AGENTS.md"), "utf8");
    expect(agents).toStartWith("# Mine\n\nKeep this.\n\n<!-- optz:start -->");
    expect(JSON.parse(readFileSync(join(dir, ".mcp.json"), "utf8")).mcpServers).toEqual({ other: { command: "x" }, optz: { type: "stdio", command: "bunx", args: ["optz", "mcp"] } });
    expect(readFileSync(join(dir, ".codex/config.toml"), "utf8")).toBe('[mcp_servers.optz]\ncommand = "bunx"\nargs = ["optz","mcp"]\n');
    expect(readFileSync(join(dir, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    // Running again changes nothing.
    expect(writeAgentFiles(dir, undefined, true)).toEqual([]);
    expect(Object.keys(agentFiles(dir, ["cursor"])).sort()).toEqual([".cursor/mcp.json", "AGENTS.md"]);
  });

  test("optz mcp answers over stdio with the project's tools", async () => {
    const root = join(import.meta.dir, "../../apps/features");
    const p = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), "mcp"], { cwd: root, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
    const send = (m: unknown) => p.stdin.write(JSON.stringify(m) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "optz_match_url", arguments: { url: "/docs/guide/setup" } } });
    send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "optz_docs", arguments: { query: "server actions" } } });
    await p.stdin.flush();
    const replies: Record<number, any> = {};
    const reader = p.stdout.getReader();
    let buf = "";
    while (Object.keys(replies).length < 4) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
      for (const line of buf.split("\n").slice(0, -1)) replies[JSON.parse(line).id] = JSON.parse(line);
      buf = buf.slice(buf.lastIndexOf("\n") + 1);
    }
    p.kill();
    expect(replies[1].result.serverInfo.name).toBe("optz");
    expect(replies[2].result.tools.map((t: { name: string }) => t.name)).toEqual(["optz_project", "optz_match_url", "optz_docs", "optz_scaffold", "optz_check", "optz_build", "optz_fetch"]);
    expect(replies[3].result.structuredContent).toMatchObject({ kind: "page", pattern: "/docs/[[...slug]]", params: { slug: "guide/setup" } });
    expect(replies[4].result.content[0].text).toContain("## Server Actions");
  }, 20_000);
});
