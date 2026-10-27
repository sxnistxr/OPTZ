// Model Context Protocol: the app as a server AI clients can use (Claude, ChatGPT, Codex,
// Cursor, VS Code, Gemini CLI, ...). Files in app/mcp become tools, prompts and resources:
//
//   app/mcp/search_posts.ts   export default defineTool({ description, input, run })
//   app/mcp/summarize.ts      export default definePrompt({ description, arguments, run })
//   app/mcp/changelog.ts      export default defineResource({ uri, read })
//
// The file name (folders joined with "_") is the name unless the definition sets one. They're
// served at /mcp (config `mcp.path`) over the protocol's Streamable HTTP transport, stateless:
// every POST is one JSON-RPC message (or a batch) answered with JSON, so it runs the same on
// Bun, the compiled binary and edge workers, behind any load balancer. The request goes through
// app/middleware.ts first, so authentication works like it does for API routes, and tools can
// call cookies(), headers() and after() from optz/server.
//
// With `mcp.pages` (default on) the site's pre-rendered pages are resources too, as text, with
// `search_pages` and `read_page` tools: a docs site is useful to an AI with no code at all.
//
// Web-standard code only (no node: imports).
import type { Locals, ResolvedConfig } from "./types";

// ---- JSON Schema, and the argument types it implies -----------------------------------------

export type JsonSchema = {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";
  description?: string;
  title?: string;
  enum?: readonly (string | number | boolean | null)[];
  default?: unknown;
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  [key: string]: unknown;
};

type Simplify<T> = { [K in keyof T]: T[K] } & {};
type ObjectOf<P, R> = Simplify<{ -readonly [K in keyof P & R]: Infer<P[K]> } & { -readonly [K in Exclude<keyof P, R>]?: Infer<P[K]> }>;
/** The TypeScript type a JSON Schema describes (declare the schema inline or `as const`). */
export type Infer<S> = S extends { enum: readonly (infer E)[] }
  ? E
  : S extends { type: "string" }
    ? string
    : S extends { type: "number" | "integer" }
      ? number
      : S extends { type: "boolean" }
        ? boolean
        : S extends { type: "null" }
          ? null
          : S extends { type: "array"; items: infer I }
            ? Infer<I>[]
            : S extends { type: "object"; properties: infer P }
              ? ObjectOf<P, S extends { required: readonly (infer R)[] } ? R : never>
              : S extends { type: "object" }
                ? Record<string, unknown>
                : unknown;

/** Checks `value` against the parts of JSON Schema tools use (types, enum, required,
 *  properties, items, lengths, ranges, pattern) and fills in top-level defaults.
 *  Returns an error message, or null when it's valid. */
export function validate(schema: JsonSchema | undefined, value: unknown, path = "arguments"): string | null {
  if (!schema) return null;
  if (schema.enum && !schema.enum.some((e) => e === value)) return `${path} must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`;
  const t = schema.type;
  const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (t === "integer" ? !(typeof value === "number" && Number.isInteger(value)) : t && t !== kind) return `${path} must be ${t === "array" || t === "object" || t === "integer" ? "an" : "a"} ${t}`;
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${path} must be at least ${schema.minLength} characters`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} must be at most ${schema.maxLength} characters`;
    if (schema.pattern && !new RegExp(schema.pattern, "u").test(value)) return `${path} must match ${schema.pattern}`;
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) return `${path} must be >= ${schema.minimum}`;
    if (schema.maximum !== undefined && value > schema.maximum) return `${path} must be <= ${schema.maximum}`;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${path} needs at least ${schema.minItems} items`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} takes at most ${schema.maxItems} items`;
    for (let i = 0; i < value.length; i++) {
      const e = validate(schema.items, value[i], `${path}[${i}]`);
      if (e) return e;
    }
  }
  if (kind === "object") {
    const o = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (o[k] === undefined) return `${path}.${k} is required`;
    for (const [k, v] of Object.entries(o)) {
      const sub = schema.properties?.[k];
      if (sub) {
        const e = validate(sub, v, `${path}.${k}`);
        if (e) return e;
      } else if (schema.additionalProperties === false) return `${path}.${k} is not a known argument`;
      else if (typeof schema.additionalProperties === "object") {
        const e = validate(schema.additionalProperties, v, `${path}.${k}`);
        if (e) return e;
      }
    }
  }
  return null;
}

// ---- definitions ---------------------------------------------------------------------------

export interface McpContext {
  request: Request;
  url: URL;
  /** Values set by middleware, e.g. the authenticated user. */
  locals: Locals;
}

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "resource_link"; uri: string; name: string; description?: string; mimeType?: string }
  | { type: "resource"; resource: { uri: string; mimeType?: string; text?: string; blob?: string } };

export interface McpToolResult {
  content: McpContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Throw from a tool to answer with an error the model sees (and can correct its call for). */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolError";
  }
}

export interface ToolAnnotations {
  /** Doesn't change anything. */
  readOnlyHint?: boolean;
  /** May delete or overwrite (only meaningful when not read-only). */
  destructiveHint?: boolean;
  /** Calling it twice with the same arguments does nothing more. */
  idempotentHint?: boolean;
  /** Reaches things outside this app (the web, other services). */
  openWorldHint?: boolean;
  title?: string;
}

export interface ToolDef<S extends JsonSchema = JsonSchema> {
  /** Defaults to the file name. Letters, digits, "_" and "-". */
  name?: string;
  title?: string;
  /** What it does and when to use it: the model reads this to decide. */
  description: string;
  /** JSON Schema of the arguments (an object). Arguments are validated before `run`. */
  input?: S;
  /** JSON Schema of `structuredContent`, for clients that check it. */
  output?: JsonSchema;
  annotations?: ToolAnnotations;
  /** A string becomes text content; an object becomes JSON text plus `structuredContent`;
   *  a full `{ content }` result is passed through. */
  run: (args: Infer<S>, ctx: McpContext) => unknown;
}

export interface PromptDef {
  name?: string;
  title?: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
  /** A string becomes one user message. */
  run: (args: Record<string, string>, ctx: McpContext) => string | PromptMessage[] | Promise<string | PromptMessage[]>;
}
export interface PromptMessage {
  role: "user" | "assistant";
  content: McpContent;
}

export interface ResourceDef {
  /** A fixed URI ("docs://changelog"), or a template with {params} ("posts://{slug}"). */
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
  /** Lists what a template resource can be (optional). */
  list?: (ctx: McpContext) => Array<{ uri: string; name: string; title?: string; description?: string; mimeType?: string }> | Promise<Array<{ uri: string; name: string; title?: string; description?: string; mimeType?: string }>>;
  /** Text (string), JSON (object) or binary ({ blob: base64 }). Template params are in `params`. */
  read: (params: Record<string, string>, ctx: McpContext) => unknown;
}

const KIND = Symbol.for("optz.mcp");
type Tagged<T> = T & { [KIND]: "tool" | "prompt" | "resource" };

/** An MCP tool. `input` types `run`'s arguments:
 *  export default defineTool({
 *    description: "Search the blog",
 *    input: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
 *    annotations: { readOnlyHint: true },
 *    run: ({ q }) => searchPosts(q),
 *  }); */
export const defineTool = <const S extends JsonSchema>(t: ToolDef<S>) => Object.assign(t, { [KIND]: "tool" as const }) as Tagged<ToolDef<S>>;
export const definePrompt = (p: PromptDef) => Object.assign(p, { [KIND]: "prompt" as const }) as Tagged<PromptDef>;
export const defineResource = (r: ResourceDef) => Object.assign(r, { [KIND]: "resource" as const }) as Tagged<ResourceDef>;

// ---- the server ------------------------------------------------------------------------------

/** Newest first. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export interface McpPage {
  path: string;
  title: string;
  description: string;
  /** The page as Markdown-ish text. */
  text: string;
}

export interface McpServerOptions {
  config: ResolvedConfig;
  /** app/mcp modules, by file (relative to the project root). */
  modules: Array<{ file: string; mod: unknown }>;
  /** The site's pages, for `mcp.pages`. Loaded on first use. */
  pages?: () => McpPage[];
  /** May this caller see this page? (The app's middleware decides: pages it protects stay
   *  protected over MCP.) Default: every page. */
  canRead?: (path: string, ctx: McpContext) => Promise<boolean>;
  dev?: boolean;
}

interface Rpc {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

const rpcError = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/** "app/mcp/posts/search.ts" -> "posts_search" */
export const mcpName = (file: string) =>
  file
    .replace(/^app\/mcp\//, "")
    .replace(/\.(ts|tsx|js|jsx)$/, "")
    .replace(/\/index$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "_");

/** Turns a URI template ("posts://{slug}") into a matcher. */
function template(uri: string): ((u: string) => Record<string, string> | null) | null {
  if (!uri.includes("{")) return null;
  const names: string[] = [];
  const re = new RegExp(
    "^" +
      uri.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\?\{(\+?)(\w+)\\?\}/g, (_m, plus: string, n: string) => {
        names.push(n);
        return plus ? "(.+)" : "([^/]+)";
      }) +
      "$",
  );
  return (u) => {
    const m = u.match(re);
    if (!m) return null;
    const out: Record<string, string> = {};
    names.forEach((n, i) => {
      try {
        out[n] = decodeURIComponent(m[i + 1]);
      } catch {
        out[n] = m[i + 1];
      }
    });
    return out;
  };
}

export function toolResult(v: unknown): McpToolResult {
  if (v && typeof v === "object" && Array.isArray((v as McpToolResult).content)) return v as McpToolResult;
  if (typeof v === "string") return { content: [{ type: "text", text: v }] };
  if (v === undefined) return { content: [{ type: "text", text: "done" }] };
  const text = JSON.stringify(v, null, 2);
  return v && typeof v === "object" && !Array.isArray(v) ? { content: [{ type: "text", text }], structuredContent: v as Record<string, unknown> } : { content: [{ type: "text", text }] };
}

function resourceContents(uri: string, mimeType: string | undefined, v: unknown) {
  if (v && typeof v === "object" && typeof (v as { blob?: unknown }).blob === "string") return { uri, mimeType: mimeType ?? "application/octet-stream", blob: (v as { blob: string }).blob };
  if (typeof v === "string") return { uri, mimeType: mimeType ?? "text/plain", text: v };
  return { uri, mimeType: mimeType ?? "application/json", text: JSON.stringify(v, null, 2) };
}

/** Origins a browser may call the endpoint from. Clients that aren't browsers send no Origin.
 *  Checking it is what stops a web page using DNS rebinding to reach a local server. */
function originAllowed(origin: string | null, url: URL, config: ResolvedConfig): boolean {
  if (!origin) return true;
  const allowed = new Set(config.mcp?.allowedOrigins ?? []);
  if (config.site?.url) allowed.add(new URL(config.site.url).origin);
  // A page served by this server on a loopback name can't be a rebinding attack.
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname)) allowed.add(url.origin);
  try {
    return allowed.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function createMcpServer({ config, modules, pages, canRead, dev }: McpServerOptions) {
  const tools = new Map<string, ToolDef>();
  const prompts = new Map<string, PromptDef>();
  const resources: Array<ResourceDef & { name: string; match: ReturnType<typeof template> }> = [];
  for (const { file, mod } of modules) {
    const d = (mod as { default?: Tagged<ToolDef | PromptDef | ResourceDef> }).default;
    const kind = d?.[KIND];
    if (!kind) throw new Error(`${file}: an MCP module must \`export default\` defineTool(), definePrompt() or defineResource() from "optz/mcp"`);
    const name = d.name ?? mcpName(file);
    if (kind === "tool") {
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(name)) throw new Error(`${file}: tool name "${name}" may only use letters, digits, "_", "-" and "."`);
      if (tools.has(name)) throw new Error(`${file}: two MCP tools are named "${name}"`);
      tools.set(name, d as ToolDef);
    } else if (kind === "prompt") prompts.set(name, d as PromptDef);
    else resources.push({ ...(d as ResourceDef), name, match: template((d as ResourceDef).uri) });
  }

  // ---- the site's pages as resources and two read-only tools ----
  const site = config.site?.url?.replace(/\/$/, "");
  const usePages = !!pages && config.mcp?.pages !== false;
  const pageUri = (path: string) => (site ? site + (path === "/" ? "" : path) : `page://${path}`);
  let pageList: McpPage[] | undefined;
  const allPages = () => (pageList ??= pages?.() ?? []);
  const readable = async <P extends McpPage>(list: P[], ctx: McpContext): Promise<P[]> => {
    if (!canRead) return list;
    const ok = await Promise.all(list.map((p) => canRead(p.path, ctx)));
    return list.filter((_, i) => ok[i]);
  };
  const findPage = (pathOrUrl: string) => {
    let p = pathOrUrl.trim();
    if (site && p.startsWith(site)) p = p.slice(site.length) || "/";
    if (p.startsWith("page://")) p = p.slice(7);
    try {
      if (/^https?:\/\//.test(p)) p = new URL(p).pathname;
    } catch {}
    p = "/" + p.replace(/^\/+|\/+$/g, "");
    return allPages().find((x) => x.path === p);
  };
  if (usePages) {
    if (!tools.has("search_pages"))
      tools.set("search_pages", {
        title: "Search pages",
        description: `Search ${site ?? "this site"}'s pages by words in their title, description and text. Returns the best matches with their paths; read one with read_page.`,
        input: { type: "object", properties: { query: { type: "string", description: "Words to look for" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 8 } }, required: ["query"] },
        annotations: { readOnlyHint: true, openWorldHint: false },
        run: async (a, ctx) => {
          const { query, limit = 8 } = a as { query: string; limit?: number };
          return { results: (await readable(searchPages(allPages(), query, limit), ctx)).map((p) => ({ path: p.path, url: pageUri(p.path), title: p.title, description: p.description, excerpt: p.excerpt })) };
        },
      });
    if (!tools.has("read_page"))
      tools.set("read_page", {
        title: "Read a page",
        description: `Read one of ${site ?? "this site"}'s pages as text, by path ("/docs/getting-started") or full URL.`,
        input: { type: "object", properties: { path: { type: "string", description: "Path or URL of the page" } }, required: ["path"] },
        annotations: { readOnlyHint: true, openWorldHint: false },
        run: async (a, ctx) => {
          const found = findPage((a as { path: string }).path);
          const p = found && (await readable([found], ctx))[0];
          if (!p) throw new ToolError(`No page at ${(a as { path: string }).path}. Use search_pages to find one.`);
          return `# ${p.title}\n\n${p.description ? `> ${p.description}\n\n` : ""}${p.text}\n\nSource: ${pageUri(p.path)}`;
        },
      });
  }

  const info = {
    name: config.mcp?.name ?? (site ? new URL(site).hostname : "optz-app"),
    title: config.mcp?.title,
    version: config.mcp?.version ?? "1.0.0",
  };
  const capabilities: Record<string, unknown> = {};
  if (tools.size) capabilities.tools = { listChanged: false };
  if (prompts.size) capabilities.prompts = { listChanged: false };
  if (resources.length || usePages) capabilities.resources = { listChanged: false, subscribe: false };
  capabilities.logging = {};

  const failure = (e: unknown, what: string): McpToolResult => {
    if (!(e instanceof ToolError)) console.error(`optz: MCP ${what}:`, e);
    const msg = e instanceof ToolError || dev ? String((e as Error)?.message ?? e) : `${what} failed`;
    return { content: [{ type: "text", text: msg }], isError: true };
  };

  async function call(m: Rpc, ctx: McpContext): Promise<unknown> {
    const p = m.params ?? {};
    switch (m.method) {
      case "initialize": {
        const want = String(p.protocolVersion ?? "");
        return {
          protocolVersion: PROTOCOL_VERSIONS.includes(want) ? want : PROTOCOL_VERSIONS[0],
          capabilities,
          serverInfo: Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined)),
          ...(config.mcp?.instructions || usePages
            ? { instructions: config.mcp?.instructions ?? `Pages of ${site ?? "this site"}: find them with search_pages, then read_page.` }
            : {}),
        };
      }
      case "ping":
      case "logging/setLevel":
        return {};
      case "tools/list":
        return {
          tools: [...tools].map(([name, t]) => ({
            name,
            ...(t.title ? { title: t.title } : {}),
            description: t.description,
            inputSchema: t.input ?? { type: "object", properties: {} },
            ...(t.output ? { outputSchema: t.output } : {}),
            ...(t.annotations ? { annotations: t.annotations } : {}),
          })),
        };
      case "tools/call": {
        const t = tools.get(String(p.name));
        if (!t) throw Object.assign(new Error(`Unknown tool: ${String(p.name)}`), { code: -32602 });
        const args = { ...((p.arguments as Record<string, unknown>) ?? {}) };
        // Defaults first, so `run` sees what the schema promised.
        for (const [k, s] of Object.entries(t.input?.properties ?? {})) if (args[k] === undefined && s.default !== undefined) args[k] = s.default;
        const bad = validate(t.input, args);
        if (bad) return { content: [{ type: "text", text: `Invalid arguments: ${bad}` }], isError: true };
        try {
          return toolResult(await t.run(args as never, ctx));
        } catch (e) {
          return failure(e, `tool ${String(p.name)}`);
        }
      }
      case "prompts/list":
        return {
          prompts: [...prompts].map(([name, d]) => ({ name, ...(d.title ? { title: d.title } : {}), ...(d.description ? { description: d.description } : {}), arguments: d.arguments ?? [] })),
        };
      case "prompts/get": {
        const d = prompts.get(String(p.name));
        if (!d) throw Object.assign(new Error(`Unknown prompt: ${String(p.name)}`), { code: -32602 });
        const args = (p.arguments as Record<string, string>) ?? {};
        for (const a of d.arguments ?? []) if (a.required && !args[a.name]) throw Object.assign(new Error(`Missing argument: ${a.name}`), { code: -32602 });
        const out = await d.run(args, ctx);
        return { ...(d.description ? { description: d.description } : {}), messages: typeof out === "string" ? [{ role: "user", content: { type: "text", text: out } }] : out };
      }
      case "resources/list": {
        const list: unknown[] = [];
        for (const r of resources) {
          if (!r.match) list.push({ uri: r.uri, name: r.name, ...(r.title ? { title: r.title } : {}), ...(r.description ? { description: r.description } : {}), ...(r.mimeType ? { mimeType: r.mimeType } : {}) });
          else if (r.list) list.push(...(await r.list(ctx)));
        }
        if (usePages) for (const pg of await readable(allPages(), ctx)) list.push({ uri: pageUri(pg.path), name: pg.path, title: pg.title, ...(pg.description ? { description: pg.description } : {}), mimeType: "text/markdown" });
        return { resources: list };
      }
      case "resources/templates/list":
        return {
          resourceTemplates: resources
            .filter((r) => r.match)
            .map((r) => ({ uriTemplate: r.uri, name: r.name, ...(r.title ? { title: r.title } : {}), ...(r.description ? { description: r.description } : {}), ...(r.mimeType ? { mimeType: r.mimeType } : {}) })),
        };
      case "resources/read": {
        const uri = String(p.uri ?? "");
        for (const r of resources) {
          const params = r.match ? r.match(uri) : r.uri === uri ? {} : null;
          if (params) return { contents: [resourceContents(uri, r.mimeType, await r.read(params, ctx))] };
        }
        const found = usePages ? findPage(uri) : undefined;
        const pg = found && (await readable([found], ctx))[0];
        if (pg) return { contents: [{ uri, mimeType: "text/markdown", text: `# ${pg.title}\n\n${pg.text}` }] };
        throw Object.assign(new Error(`Resource not found: ${uri}`), { code: -32002 });
      }
      case "completion/complete":
        return { completion: { values: [], hasMore: false } };
      default:
        throw Object.assign(new Error(`Method not found: ${m.method}`), { code: -32601 });
    }
  }

  async function one(m: unknown, ctx: McpContext): Promise<unknown | null> {
    if (!m || typeof m !== "object" || (m as Rpc).jsonrpc !== "2.0") return rpcError(null, -32600, "Invalid Request");
    const r = m as Rpc;
    // Responses and notifications (no id) get no answer.
    if (typeof r.method !== "string") return null;
    if (r.id === undefined) return null;
    try {
      return { jsonrpc: "2.0", id: r.id, result: await call(r, ctx) };
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (!code) console.error(`optz: MCP ${r.method}:`, e);
      return rpcError(r.id, code ?? -32603, code || dev ? String((e as Error).message) : "Internal error");
    }
  }

  return {
    tools,
    prompts,
    resources,
    /** One JSON-RPC message in, its response (or null for notifications) out: for transports
     *  other than HTTP, like `optz mcp`'s stdio. */
    message: one,
    async handle(ctx: McpContext): Promise<Response> {
      const { request: req, url } = ctx;
      if (!originAllowed(req.headers.get("origin"), url, config)) return json(rpcError(null, -32600, "Origin not allowed"), 403);
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: { Allow: "POST, OPTIONS" } });
      // No server-to-client stream: everything is answered on the POST.
      if (req.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST, OPTIONS" } });
      const v = req.headers.get("mcp-protocol-version");
      if (v && !PROTOCOL_VERSIONS.includes(v)) return json(rpcError(null, -32600, `Unsupported MCP-Protocol-Version: ${v}`), 400);
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return json(rpcError(null, -32700, "Parse error"), 400);
      }
      if (Array.isArray(body)) {
        if (!body.length) return json(rpcError(null, -32600, "Invalid Request"), 400);
        const out = (await Promise.all(body.map((m) => one(m, ctx)))).filter((x) => x !== null);
        return out.length ? json(out) : new Response(null, { status: 202 });
      }
      const out = await one(body, ctx);
      return out === null ? new Response(null, { status: 202 }) : json(out);
    },
  };
}

// ---- pages as text ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
  );

/** A page's title, description and main content as Markdown-ish text, for AI clients and
 *  llms.txt. Not a full HTML parser: it reads what optz renders. */
export function pageText(html: string): { title: string; description: string; text: string } {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "");
  const description = decodeEntities(html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1] ?? "");
  let body = html.match(/<main[^>]*>([\s\S]*)<\/main>/i)?.[1] ?? html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  body = body
    .replace(/<(script|style|template|noscript|svg|nav|header|footer|aside|form|button)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_m, c: string) => `\n\n\`\`\`\n${c.replace(/<[^>]+>/g, "")}\n\`\`\`\n\n`)
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${t.replace(/<[^>]+>/g, "").trim()}\n\n`)
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, t: string) => {
      const label = t.replace(/<[^>]+>/g, "").trim();
      return label && !href.startsWith("#") ? `[${label}](${href})` : label;
    })
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|ul|ol|li|tr|table|blockquote|figure|dl|dd|dt)>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  const text = decodeEntities(body)
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, description, text };
}

/** Ranks pages by how often and where the query's words appear. */
export function searchPages(pages: McpPage[], query: string, limit = 8) {
  const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  return pages
    .map((p) => {
      const t = p.title.toLowerCase();
      const d = p.description.toLowerCase();
      const x = p.text.toLowerCase();
      let score = 0;
      for (const w of words) {
        if (t.includes(w)) score += 10;
        if (d.includes(w)) score += 4;
        score += Math.min(x.split(w).length - 1, 10);
      }
      const at = x.indexOf(words[0]);
      const excerpt = at < 0 ? p.text.slice(0, 200) : p.text.slice(Math.max(0, at - 80), at + 200).replace(/\s+/g, " ").trim();
      return { ...p, score, excerpt };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** The pre-rendered pages among built files ("/docs/x/index.html" is "/docs/x"), skipping
 *  internal files, 404 pages, noindex pages and paths starting with one of `exclude`. */
export function sitePages(files: Iterable<[string, Uint8Array]>, exclude: string[] = []): McpPage[] {
  const out: McpPage[] = [];
  const dec = new TextDecoder();
  for (const [url, body] of files) {
    if (!url.endsWith("/index.html") || url.startsWith("/_optz/")) continue;
    const path = url === "/index.html" ? "/" : url.slice(0, -"/index.html".length);
    if (exclude.some((e) => path === e || path.startsWith(e.endsWith("/") ? e : e + "/"))) continue;
    const html = dec.decode(body);
    if (/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(html)) continue;
    const { title, description, text } = pageText(html);
    out.push({ path, title: title || path, description, text });
  }
  // "Post | Site" -> "Post" when other pages share the suffix: the site name is noise per page.
  const suffix = (t: string) => t.match(/ (?:\||—|–|·) [^|—–·]+$/)?.[0];
  const counts = new Map<string, number>();
  for (const p of out) {
    const s = suffix(p.title);
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  for (const p of out) {
    const s = suffix(p.title);
    if (s && counts.get(s)! > 1) p.title = p.title.slice(0, -s.length);
  }
  return out.sort((a, b) => (a.path === "/" ? -1 : b.path === "/" ? 1 : a.path.localeCompare(b.path)));
}
