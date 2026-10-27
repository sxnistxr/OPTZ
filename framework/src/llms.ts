// /llms.txt and /llms-full.txt (llmstxt.org): what a language model should read about the site,
// written at build time from the pre-rendered pages, like sitemap.xml is for search engines.
//   app/llms.ts   export default (pages) => string    replaces the generated /llms.txt
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { sitePages, type McpPage } from "./mcp";
import type { ResolvedConfig } from "./types";

/** Section names for the first path segment ("/docs/x" -> "Docs"). */
const sectionOf = (path: string) => {
  const first = path.split("/")[1];
  return !first || !path.slice(1).includes("/") ? "Pages" : first[0].toUpperCase() + first.slice(1).replace(/[-_]/g, " ");
};

export function llmsTxt(pages: McpPage[], opts: { title?: string; description?: string; base?: string; mcpUrl?: string }): string {
  const abs = (p: string) => (opts.base ? opts.base.replace(/\/$/, "") + (p === "/" ? "/" : p) : p);
  const home = pages.find((p) => p.path === "/");
  const lines = [`# ${opts.title ?? home?.title ?? "Site"}`, ""];
  const desc = opts.description ?? home?.description;
  if (desc) lines.push(`> ${desc}`, "");
  if (opts.mcpUrl) lines.push(`This site is also an MCP server: ${opts.mcpUrl} (Streamable HTTP). Connect an AI client to search and read it.`, "");
  const sections = new Map<string, McpPage[]>();
  for (const p of pages) {
    const s = sectionOf(p.path);
    sections.set(s, [...(sections.get(s) ?? []), p]);
  }
  // Single pages first, then sections in path order.
  const names = [...sections.keys()].sort((a, b) => (a === "Pages" ? -1 : b === "Pages" ? 1 : a.localeCompare(b)));
  for (const s of names) {
    lines.push(`## ${s}`, "");
    for (const p of sections.get(s)!) lines.push(`- [${p.title}](${abs(p.path)})${p.description ? `: ${p.description}` : ""}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function llmsFullTxt(pages: McpPage[], base?: string): string {
  const abs = (p: string) => (base ? base.replace(/\/$/, "") + (p === "/" ? "/" : p) : p);
  return pages.map((p) => `# ${p.title}\n\nSource: ${abs(p.path)}\n\n${p.description ? `> ${p.description}\n\n` : ""}${p.text}\n`).join("\n---\n\n");
}

/** Reads every built page from dist/static. */
function builtPages(staticDir: string, exclude: string[]): McpPage[] {
  const files: Array<[string, Uint8Array]> = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const f = join(d, e);
      if (statSync(f).isDirectory()) walk(f);
      else if (e === "index.html") files.push(["/" + relative(staticDir, f).split("\\").join("/"), readFileSync(f)]);
    }
  };
  if (existsSync(staticDir)) walk(staticDir);
  return sitePages(files, exclude);
}

/** Writes llms.txt (and llms-full.txt). Returns how many files. */
export async function buildLlmsFiles(root: string, config: ResolvedConfig, staticDir: string): Promise<number> {
  if (config.llms === false) return 0;
  const o = config.llms ?? {};
  const pages = builtPages(staticDir, o.exclude ?? []);
  const custom = ["ts", "tsx", "js"].map((e) => join(root, `app/llms.${e}`)).find(existsSync);
  if (!pages.length && !custom) return 0;
  const base = config.site?.url;
  const mcpOn = config.features.mcp && (!!config.mcp || existsSync(join(root, "app/mcp")));
  const mcpUrl = mcpOn ? (base ? base.replace(/\/$/, "") : "") + (config.mcp?.path ?? "/mcp") : undefined;
  const txt = custom ? String(await (await import(custom)).default(pages)) : llmsTxt(pages, { title: o.title, description: o.description, base, mcpUrl });
  writeFileSync(join(staticDir, "llms.txt"), txt);
  if (o.full === false || !pages.length) return 1;
  writeFileSync(join(staticDir, "llms-full.txt"), llmsFullTxt(pages, base));
  return 2;
}
