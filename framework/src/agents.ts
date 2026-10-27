import { readTextIfPresent, writeFileAtomic } from "./file-io";
import { trimSlashes } from "./match";
// optz and coding agents (Claude Code, Codex, Cursor, VS Code Copilot, Gemini CLI, ...):
//
//   optz mcp      an MCP server over stdio with tools for working on this project: what's in
//                 it, which file answers a URL, the framework docs, scaffolding, check and
//                 build, and requests to the running dev server.
//   optz agents   writes the files agents read: AGENTS.md (+ CLAUDE.md importing it), skills
//                 in .claude/skills and .agents/skills, and each client's MCP config pointing
//                 at `optz mcp`. Re-running updates them and keeps anything else in those files.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { scanActions } from "./actions";
import { createMcpServer, defineTool, definePrompt, defineResource, pageText, ToolError } from "./mcp";
import { matchRoute, scanApi, scanMcp, scanRoutes, sortRoutes } from "./routes";
import type { ResolvedConfig } from "./types";

const FRAMEWORK = join(import.meta.dir, "..");
const SKILLS = join(FRAMEWORK, "skills");
const rel = (root: string, f: string) => relative(root, f).split(sep).join("/");

// ---- optz agents -----------------------------------------------------------------------------

export type AgentClient = "claude" | "codex" | "cursor" | "vscode" | "gemini";
export const AGENT_CLIENTS: AgentClient[] = ["claude", "codex", "cursor", "vscode", "gemini"];

const START = "<!-- optz:start -->";
const END = "<!-- optz:end -->";

export const agentsSection = () => `${START}
## optz

This is an [optz](https://dihlabs.lol/docs/framework) app: a small React framework for Bun. It
looks like Next.js but isn't (no \`"use client"\`, no \`next/*\`); pages are HTML by default and only
\`*.island.tsx\` components ship JavaScript.

- Pages: \`app/routes\` (\`[param]\`, \`[...rest]\`, \`_layout.tsx\`); API routes: \`app/api\`; Server
  Actions: modules starting with \`"use server"\`; MCP tools for AI clients: \`app/mcp\`.
- Render modes: \`static\` (default, built ahead), \`client\` (one shell, islands fetch), \`dynamic\`
  (per request, streamed). Prefer the cheapest that works.
- Before finishing: \`bun run check\` (route types + tsc) and \`bun run build\` must pass.
- Don't edit generated \`.optz/\` or \`dist/\`.
- The \`optz\` MCP server (\`optz mcp\`) has tools for this: \`optz_project\`, \`optz_match_url\`,
  \`optz_docs\`, \`optz_scaffold\`, \`optz_check\`, \`optz_build\`, \`optz_fetch\`. Skills: \`optz\`
  (building) and \`optz-mcp\` (exposing the app to AI clients).
${END}`;

/** Replaces the optz section of a Markdown file, or appends one. */
function upsertSection(file: string, section: string, header = "# Agent guide\n\n"): string {
  const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
  if (!cur) return header + section + "\n";
  const a = cur.indexOf(START);
  const b = cur.indexOf(END);
  if (a >= 0 && b > a) return cur.slice(0, a) + section + cur.slice(b + END.length);
  return cur.trimEnd() + "\n\n" + section + "\n";
}

function mergeJson(file: string, key: string, name: string, entry: unknown): string {
  let cur: Record<string, unknown> = {};
  if (existsSync(file)) {
    try {
      cur = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new Error(`${file} isn't valid JSON; fix or remove it and run optz agents again`);
    }
  }
  const servers = { ...((cur[key] as Record<string, unknown>) ?? {}), [name]: entry };
  return JSON.stringify({ ...cur, [key]: servers }, null, 2) + "\n";
}

function upsertToml(file: string, name: string, command: string, args: string[]): string {
  const cur = existsSync(file) ? readFileSync(file, "utf8") : "";
  const block = `[mcp_servers.${name}]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n`;
  const re = new RegExp(`\\[mcp_servers\\.${name}\\]\\n(?:(?!\\[)[^\\n]*\\n?)*`);
  if (re.test(cur)) return cur.replace(re, block + "\n").trimEnd() + "\n";
  return (cur.trimEnd() ? cur.trimEnd() + "\n\n" : "") + block;
}

/** The files `optz agents` writes, path -> content (not written yet). */
export function agentFiles(root: string, clients: AgentClient[] = AGENT_CLIENTS): Record<string, string> {
  const out: Record<string, string> = {};
  const command = "bunx";
  const args = ["optz", "mcp"];
  out["AGENTS.md"] = upsertSection(join(root, "AGENTS.md"), agentsSection());
  const skills = readdirSync(SKILLS).filter((d) => existsSync(join(SKILLS, d, "SKILL.md")));
  const skillDirs = [...(clients.includes("claude") ? [".claude/skills"] : []), ...(clients.includes("codex") ? [".agents/skills"] : [])];
  for (const dir of skillDirs) for (const s of skills) out[`${dir}/${s}/SKILL.md`] = readFileSync(join(SKILLS, s, "SKILL.md"), "utf8");
  if (clients.includes("claude")) {
    const claudeMd = join(root, "CLAUDE.md");
    const cur = existsSync(claudeMd) ? readFileSync(claudeMd, "utf8") : "";
    if (!/^@AGENTS\.md\s*$/m.test(cur)) out["CLAUDE.md"] = cur ? cur.trimEnd() + "\n\n@AGENTS.md\n" : "@AGENTS.md\n";
    out[".mcp.json"] = mergeJson(join(root, ".mcp.json"), "mcpServers", "optz", { type: "stdio", command, args });
  }
  if (clients.includes("codex")) out[".codex/config.toml"] = upsertToml(join(root, ".codex/config.toml"), "optz", command, args);
  if (clients.includes("cursor")) out[".cursor/mcp.json"] = mergeJson(join(root, ".cursor/mcp.json"), "mcpServers", "optz", { command, args });
  if (clients.includes("vscode")) out[".vscode/mcp.json"] = mergeJson(join(root, ".vscode/mcp.json"), "servers", "optz", { type: "stdio", command, args });
  if (clients.includes("gemini")) out[".gemini/settings.json"] = mergeJson(join(root, ".gemini/settings.json"), "mcpServers", "optz", { command, args });
  return out;
}

export function writeAgentFiles(root: string, clients: AgentClient[] = AGENT_CLIENTS, quiet = false): string[] {
  const files = agentFiles(root, clients);
  const changed: string[] = [];
  for (const [f, content] of Object.entries(files)) {
    const full = join(root, f);
    if (readTextIfPresent(full) === content) continue;
    mkdirSync(dirname(full), { recursive: true });
    writeFileAtomic(full, content);
    changed.push(f);
  }
  if (!quiet) {
    console.log(changed.length ? `optz: wrote ${changed.join(", ")}` : "optz: agent files are up to date");
    if (clients.includes("codex")) console.log("optz: Codex reads .codex/config.toml in trusted projects (or run: codex mcp add optz -- bunx optz mcp)");
  }
  return changed;
}

// ---- optz mcp: the project as tools ------------------------------------------------------------

const exportsOf = (file: string) => {
  try {
    return new Bun.Transpiler({ loader: file.endsWith("x") ? "tsx" : "ts" }).scan(readFileSync(file, "utf8")).exports;
  } catch {
    return [];
  }
};
const renderOf = (file: string) => {
  const src = readFileSync(file, "utf8");
  const mode = src.match(/render\s*:\s*["'](static|client|dynamic)["']/)?.[1] ?? "static";
  return { render: mode, revalidate: src.match(/export\s+const\s+revalidate\s*=\s*(\d+)/)?.[1], loader: /export\s+(const|async function|function)\s+loader\b/.test(src) };
};
function walk(dir: string, test: (f: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) {
      if (e !== "node_modules" && !e.startsWith(".")) walk(f, test, out);
    } else if (test(f)) out.push(f);
  }
  return out;
}

/** README sections ("## ..." and "### ..."), for optz_docs. */
function docSections(): Array<{ heading: string; text: string }> {
  const md = readFileSync(join(FRAMEWORK, "README.md"), "utf8");
  const out: Array<{ heading: string; text: string }> = [];
  for (const part of md.split(/\n(?=#{2,3} )/)) {
    const heading = part.match(/^#{1,3} (.+)/)?.[1] ?? "optz";
    out.push({ heading, text: part.trim() });
  }
  return out;
}

const TEMPLATES: Record<string, (name: string) => { file: string; content: string }> = {
  page: (p) => ({
    file: `app/routes/${p}.tsx`,
    content: `import type { PageProps } from "optz";

export const head = () => ({ title: "${p}" });

export default function Page(_: PageProps) {
  return (
    <main>
      <h1>${p}</h1>
    </main>
  );
}
`,
  }),
  "dynamic-page": (p) => ({
    file: `app/routes/${p}.tsx`,
    content: `import type { LoaderContext, PageProps } from "optz";

// Rendered on every request (needs features.dynamic).
export const config = { render: "dynamic" } as const;

export const loader = ({ url }: LoaderContext) => ({ now: new Date().toISOString(), path: url.pathname });

export default function Page({ data }: PageProps<{ now: string; path: string }>) {
  return (
    <main>
      <h1>{data.path}</h1>
      <p>Rendered at {data.now}</p>
    </main>
  );
}
`,
  }),
  api: (p) => ({
    file: `app/api/${p}.ts`,
    content: `import { handler, json, type HandlerContext } from "optz";

export const GET = () => json({ ok: true });

export const POST = handler(async ({ body }: HandlerContext<{}, { text: string }>) => json({ received: (await body()).text }, { status: 201 }));
`,
  }),
  island: (p) => {
    const name = p.split("/").pop()!.replace(/(^|[-_])(\w)/g, (_m, _s, c: string) => c.toUpperCase());
    return {
      file: `app/components/${name}.island.tsx`,
      content: `import { useState } from "react";

// Hydrates in the browser; everything else on the page stays HTML.
export const hydrate = "visible";

export default function ${name}({ start = 0 }: { start?: number }) {
  const [n, setN] = useState(start);
  return <button onClick={() => setN(n + 1)}>Clicked {n} times</button>;
}
`,
    };
  },
  action: (p) => ({
    file: `app/actions/${p}.ts`,
    content: `"use server";
import { ActionError, revalidatePath } from "optz/server";

export async function save(form: FormData): Promise<void> {
  const text = String(form.get("text") ?? "").trim();
  if (!text) throw new ActionError("Write something first.");
  // ... save it
  revalidatePath("/");
}
`,
  }),
  "mcp-tool": (p) => ({
    file: `app/mcp/${p}.ts`,
    content: `import { defineTool } from "optz/mcp";

export default defineTool({
  description: "Describe what this does, what it returns and when to use it.",
  input: {
    type: "object",
    properties: { query: { type: "string", description: "What to look for" } },
    required: ["query"],
  },
  annotations: { readOnlyHint: true },
  run: ({ query }) => ({ query, results: [] }),
});
`,
  }),
  "mcp-prompt": (p) => ({
    file: `app/mcp/${p}.ts`,
    content: `import { definePrompt } from "optz/mcp";

export default definePrompt({
  description: "Describe the task this prompt starts.",
  arguments: [{ name: "topic", required: true }],
  run: ({ topic }) => \`Explain \${topic} using this site's pages (search_pages, then read_page).\`,
});
`,
  }),
  layout: (p) => ({
    file: `app/routes/${p ? p + "/" : ""}_layout.tsx`,
    content: `import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return <section>{children}</section>;
}
`,
  }),
  middleware: () => ({
    file: "app/middleware.ts",
    content: `import { defineMiddleware } from "optz";

export default defineMiddleware(async (ctx, next) => {
  const res = await next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
});
`,
  }),
};

async function run(cmd: string[], cwd: string, limit = 12_000) {
  const p = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" } });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  const code = await p.exited;
  let text = (out + (err ? "\n" + err : "")).replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (text.length > limit) text = "...\n" + text.slice(-limit);
  return { exitCode: code, ok: code === 0, output: text };
}

/** The tools, prompts and resources `optz mcp` serves for the project at `root`. */
export function projectModules(root: string, loadConfig: () => Promise<ResolvedConfig>) {
  const cli = join(import.meta.dir, "cli.ts");
  const project = defineTool({
    title: "Project overview",
    description:
      "Everything in this optz project: pages (URL pattern, file, render mode, loader, ISR), API routes and their methods, Server Actions, islands, MCP tools, middleware, and the main config. Call this first.",
    annotations: { readOnlyHint: true },
    run: async () => {
      const config = await loadConfig();
      const table = scanRoutes(join(root, "app/routes"));
      const manifestFile = join(root, "dist/manifest.json");
      return {
        root,
        config: {
          site: config.site,
          client: config.client,
          features: config.features,
          i18n: config.i18n,
          mcp: config.mcp,
          proxy: config.proxy && Object.keys(config.proxy),
        },
        pages: table.routes.map((r) => ({ pattern: r.pattern, file: rel(root, r.file), ...renderOf(r.file), layouts: r.layouts.map((l) => rel(root, l)) })),
        slots: table.slots.map((s) => ({ name: s.name, layout: rel(root, s.layout), routes: s.routes.map((r) => r.pattern) })),
        intercepts: table.intercepts.map((r) => ({ pattern: r.pattern, file: rel(root, r.file) })),
        api: scanApi(join(root, "app/api")).map((r) => ({ pattern: r.pattern, file: rel(root, r.file), methods: exportsOf(r.file).filter((e) => /^(GET|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(e)) })),
        actions: Object.values(scanActions(root)).map((a) => ({ file: a.file, exports: a.exports })),
        islands: walk(join(root, "app"), (f) => /\.island\.(tsx|jsx)$/.test(f)).map((f) => rel(root, f)),
        mcp: scanMcp(root),
        middleware: ["ts", "tsx", "js"].map((e) => `app/middleware.${e}`).find((f) => existsSync(join(root, f))) ?? null,
        built: existsSync(manifestFile) ? new Date(JSON.parse(readFileSync(manifestFile, "utf8")).builtAt).toISOString() : null,
      };
    },
  });

  const matchUrl = defineTool({
    title: "Which file answers a URL",
    description: "Find the page or API route file that handles a URL path, with its params, layouts, error and loading files.",
    input: { type: "object", properties: { url: { type: "string", description: 'A path like "/blog/hello" or a full URL' } }, required: ["url"] },
    annotations: { readOnlyHint: true },
    run: ({ url }) => {
      const path = url.startsWith("http") ? new URL(url).pathname : url.split(/[?#]/)[0];
      const table = scanRoutes(join(root, "app/routes"));
      const m = matchRoute(sortRoutes([...table.routes, ...scanApi(join(root, "app/api"))]), path);
      if (!m) return { path, match: null, notFound: table.notFound ? rel(root, table.notFound) : null };
      const r = m.route;
      return {
        path,
        kind: r.kind,
        pattern: r.pattern,
        file: rel(root, r.file),
        params: m.params,
        layouts: r.layouts.map((l) => rel(root, l)),
        error: r.error && rel(root, r.error),
        loading: r.loading && rel(root, r.loading),
        ...(r.kind === "page" ? renderOf(r.file) : { methods: exportsOf(r.file).filter((e) => /^[A-Z]+$/.test(e)) }),
      };
    },
  });

  const docs = defineTool({
    title: "optz docs",
    description:
      "The optz framework reference. With no query: the list of sections. With a query (e.g. \"server actions\", \"ISR\", \"islands\", \"middleware\", \"i18n\"): the matching sections in full.",
    input: { type: "object", properties: { query: { type: "string" } } },
    annotations: { readOnlyHint: true },
    run: ({ query }) => {
      const sections = docSections();
      if (!query) return { sections: sections.map((s) => s.heading) };
      const words = query.toLowerCase().split(/\W+/).filter(Boolean);
      const ranked = sections
        .map((s) => ({ s, score: words.reduce((n, w) => n + (s.heading.toLowerCase().includes(w) ? 10 : 0) + Math.min(s.text.toLowerCase().split(w).length - 1, 5), 0) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      if (!ranked.length) throw new ToolError(`No section mentions "${query}". Sections: ${sections.map((s) => s.heading).join(", ")}`);
      return ranked.map((x) => x.s.text).join("\n\n---\n\n");
    },
  });

  const scaffold = defineTool({
    title: "Create a file from a template",
    description:
      'Create a new page, dynamic page, API route, island, Server Action module, MCP tool, MCP prompt, layout or middleware with the right file name and a working starting point. Never overwrites. `path` is relative to its folder: "blog/[slug]" for a page, "posts/[id]" for an API route, "Counter" for an island, "search_docs" for an MCP tool.',
    input: {
      type: "object",
      properties: {
        kind: { type: "string", enum: Object.keys(TEMPLATES) },
        path: { type: "string", description: "Where, relative to its folder (no extension)", pattern: "^[\\w\\[\\]().@/-]*$" },
      },
      required: ["kind", "path"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: ({ kind, path }) => {
      const clean = trimSlashes(path).replace(/\.(tsx?|jsx?)$/, "");
      if (clean.split("/").includes("..")) throw new ToolError("path can't go up a folder");
      const t = TEMPLATES[kind](clean || "index");
      const full = join(root, t.file);
      mkdirSync(dirname(full), { recursive: true });
      try {
        writeFileSync(full, t.content, { flag: "wx" });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new ToolError(`${t.file} already exists`);
        throw e;
      }
      return { created: t.file, content: t.content };
    },
  });

  const check = defineTool({
    title: "Type-check",
    description: "Run `optz check`: regenerate route types and type-check the project with tsc. Returns the errors, if any.",
    annotations: { readOnlyHint: true, idempotentHint: true },
    run: () => run([process.execPath, cli, "check"], root),
  });

  const build = defineTool({
    title: "Build",
    description: "Run `optz build` (production build into dist/, which pre-renders static pages, so loader errors show up here). Returns its output.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    run: () => run([process.execPath, cli, "build"], root),
  });

  const fetchTool = defineTool({
    title: "Request the running app",
    description:
      "Send a request to the app's running server (`optz dev` or `optz start`, on this machine) and return status, headers and body. HTML is returned as readable text unless raw is true.",
    input: {
      type: "object",
      properties: {
        path: { type: "string", description: 'e.g. "/blog/hello" or "/api/stats?x=1"' },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"], default: "GET" },
        body: { type: "string", description: "Request body (JSON as a string)" },
        headers: { type: "object", additionalProperties: { type: "string" } },
        port: { type: "integer", description: "Default: PORT, the config's port, or 3001" },
        raw: { type: "boolean", default: false },
      },
      required: ["path"],
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
    run: async ({ path, method, body, headers, port, raw }) => {
      const config = await loadConfig();
      const p = port ?? Number(process.env.PORT ?? config.port ?? 3001);
      const url = new URL(path.startsWith("/") ? path : "/" + path, `http://127.0.0.1:${p}`);
      let res: Response;
      try {
        res = await fetch(url, {
          method,
          headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...headers },
          body: body && method !== "GET" && method !== "HEAD" ? body : undefined,
          redirect: "manual",
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new ToolError(`Nothing answered on port ${p}. Start the app with \`bun run dev\` (or pass port).`);
      }
      const type = res.headers.get("content-type") ?? "";
      let text = method === "HEAD" ? "" : await res.text();
      if (!raw && type.startsWith("text/html")) text = pageText(text).text;
      if (text.length > 20_000) text = text.slice(0, 20_000) + "\n... (truncated)";
      return { status: res.status, headers: Object.fromEntries([...res.headers].filter(([k]) => !/^(date|connection|keep-alive)$/.test(k))), body: text };
    },
  });

  const reference = defineResource({
    uri: "optz://docs/framework",
    name: "optz framework reference",
    mimeType: "text/markdown",
    read: () => readFileSync(join(FRAMEWORK, "README.md"), "utf8"),
  });
  const skills = defineResource({
    uri: "optz://skills/{name}",
    description: "Agent skills for optz: optz (building apps) and optz-mcp (exposing an app to AI clients)",
    mimeType: "text/markdown",
    list: () => readdirSync(SKILLS).map((s) => ({ uri: `optz://skills/${s}`, name: s, mimeType: "text/markdown" })),
    read: ({ name }) => {
      const f = join(SKILLS, name.replace(/[^\w-]/g, ""), "SKILL.md");
      if (!existsSync(f)) throw new ToolError(`No skill ${name}`);
      return readFileSync(f, "utf8");
    },
  });

  const addFeature = definePrompt({
    title: "Add a feature",
    description: "Plan and build a feature in this optz app the optz way.",
    arguments: [{ name: "feature", description: "What to build", required: true }],
    run: ({ feature }) =>
      `Add this to the optz app: ${feature}\n\n1. Call optz_project to see what exists, and optz_docs for the parts of optz you'll use.\n2. Pick the cheapest render mode that works (static > client > dynamic); put interactivity in small *.island.tsx components; use Server Actions for mutations from forms.\n3. Create files with optz_scaffold, then edit them.\n4. Finish only when optz_check and optz_build pass; check behavior with optz_fetch against the dev server.`,
  });
  const exposeToAi = definePrompt({
    title: "Expose the app to AI clients",
    description: "Add MCP tools so Claude, ChatGPT, Codex and others can use this app.",
    arguments: [{ name: "goal", description: "What AI clients should be able to do", required: false }],
    run: ({ goal }) =>
      `Make this optz app usable from AI clients over MCP${goal ? `, so they can: ${goal}` : ""}.\n\nRead the optz-mcp skill (resource optz://skills/optz-mcp). Look at the app's data and API routes with optz_project, then add a few focused tools in app/mcp (optz_scaffold kind "mcp-tool"): clear descriptions, tight input schemas, readOnlyHint on lookups. Set \`mcp: { instructions }\` in optz.config.ts. Protect private tools with middleware. Build, start, and call tools/list on /mcp with optz_fetch to verify.`,
  });

  const modules = Object.entries({ optz_project: project, optz_match_url: matchUrl, optz_docs: docs, optz_scaffold: scaffold, optz_check: check, optz_build: build, optz_fetch: fetchTool, reference, skills, optz_add_feature: addFeature, optz_expose_to_ai: exposeToAi }).map(
    ([name, mod]) => ({ file: `app/mcp/${name}.ts`, mod: { default: mod } }),
  );
  return modules;
}

/** `optz mcp`: newline-delimited JSON-RPC on stdin/stdout. Logs go to stderr. */
export async function serveAgentMcp(root: string, loadConfig: () => Promise<ResolvedConfig>) {
  // stdout is the protocol; anything a tool or user module prints must not land there.
  console.log = console.error;
  console.info = console.error;
  const config = await loadConfig();
  const pkg = JSON.parse(readFileSync(join(FRAMEWORK, "package.json"), "utf8")) as { version: string };
  const server = createMcpServer({
    config: {
      ...config,
      site: undefined,
      mcp: {
        name: "optz",
        title: "optz project tools",
        version: pkg.version,
        instructions: `Tools for the optz app in ${root}. Start with optz_project; read optz_docs before using an optz feature you haven't seen in this project; create files with optz_scaffold; verify with optz_check, optz_build and optz_fetch.`,
      },
    },
    modules: projectModules(root, loadConfig),
    dev: true,
  });
  const url = new URL("http://localhost/");
  const ctx = { request: new Request(url), url, locals: {} };
  const write = (v: unknown) => process.stdout.write(JSON.stringify(v) + "\n");
  const handle = async (line: string) => {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    }
    const out = Array.isArray(msg) ? (await Promise.all(msg.map((m) => server.message(m, ctx)))).filter((x) => x !== null) : await server.message(msg, ctx);
    if (out !== null && !(Array.isArray(out) && !out.length)) write(out);
  };
  const dec = new TextDecoder();
  let buf = "";
  for await (const chunk of Bun.stdin.stream()) {
    buf += dec.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) void handle(line);
    }
  }
}
