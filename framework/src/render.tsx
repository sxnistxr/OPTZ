// Server-side rendering of one page into a complete HTML document, and the data payload the
// browser fetches when it navigates to the same URL (SPA mode).
import { renderToString } from "react-dom/server";
import type { Segment } from "./match";
import { NotFound } from "./index";
import { StaticRouter, type PageState } from "./runtime";
import type { ErrorModule, Head, LayoutModule, LoaderContext, PageModule, Params, RenderMode, ResolvedConfig } from "./types";

export interface RenderInput {
  page: PageModule;
  layouts: LayoutModule[];
  error?: ErrorModule;
  pattern: string;
  segments?: Segment[];
  render?: RenderMode;
  pathname: string;
  params: Params;
  /** Skip the loader (client-rendered shells). */
  skipLoader?: boolean;
  ctx: Omit<LoaderContext, "params">;
}

export interface Assets {
  /** Script URL of the browser entry. */
  entry: string;
  /** Stylesheet URLs. */
  css: string[];
  /** Chunks to preload for this route (SPA: its module and layouts). */
  preload: string[];
  /** Islands mode: island id -> chunk URL, to preload the islands a page uses. */
  islands?: Record<string, string>;
  dev?: boolean;
}

export type Loaded =
  | { kind: "data"; payload: { data: unknown; head: Head } }
  | { kind: "redirect"; response: Response }
  | { kind: "notFound" };

export type Rendered =
  | { kind: "page"; html: string; payload: { data: unknown; head: Head } }
  | { kind: "redirect"; response: Response }
  | { kind: "notFound" };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** JSON that is safe inside a <script> element. */
export const scriptJson = (v: unknown) => JSON.stringify(v ?? null).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const attrs = (o: Record<string, string>) =>
  Object.entries(o)
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("");

const stripUndefined = (h: Head) => Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)) as Head;

export function mergeHead(input: RenderInput, data: unknown): Head {
  const head: Head = { meta: [], links: [] };
  for (const l of input.layouts) Object.assign(head, stripUndefined(l.head?.({ params: input.params }) ?? {}));
  const page = input.page.head?.(data as never, { params: input.params }) ?? {};
  return { ...head, ...stripUndefined(page) };
}

/** Runs the page's loader (thrown Responses become redirects, NotFound becomes a 404) and
 *  computes the merged head. This is what `/_optz/data/...` serves. */
export async function loadData(input: RenderInput): Promise<Loaded> {
  let data: unknown = null;
  if (input.page.loader && !input.skipLoader) {
    try {
      data = await input.page.loader({ ...input.ctx, params: input.params });
    } catch (e) {
      if (e instanceof Response) return { kind: "redirect", response: e };
      if (e instanceof NotFound) return { kind: "notFound" };
      throw e;
    }
  }
  return { kind: "data", payload: { data: data ?? null, head: mergeHead(input, data) } };
}

export async function renderPage(input: RenderInput, assets: Assets, config: ResolvedConfig): Promise<Rendered> {
  const loaded = await loadData(input);
  if (loaded.kind !== "data") return loaded;
  const { data, head } = loaded.payload;
  const state: PageState = {
    pathname: input.pathname,
    params: input.params,
    data,
    Page: input.page.default as PageState["Page"],
    layouts: input.layouts.map((l) => l.default),
    ErrorView: input.error?.default,
  };
  const body = renderToString(<StaticRouter state={state} />);
  const islandsMode = config.client.mode === "islands";

  let boot: Record<string, unknown>;
  let scripts = "";
  let preload: string[] = [];
  if (islandsMode) {
    // Only what islands need: no page data (it's already in the HTML).
    boot = { pattern: input.pattern, params: input.params };
    if (input.render === "client" && input.segments) boot.segments = input.segments;
    const used = [...new Set([...body.matchAll(/<optz-island data-id="([^"]+)" data-props="[^"]*">/g)].map((m) => m[1]))];
    preload = used.map((id) => assets.islands?.[id]).filter((u): u is string => !!u);
    // A page with no islands needs no script, unless HTML-swap navigation is on.
    if (body.includes("<optz-island") || config.client.navigation || assets.dev) scripts = `<script type="module" src="${assets.entry}"></script>`;
  } else {
    boot = { pattern: input.pattern, params: input.params, data };
    preload = assets.preload;
    scripts = `<script type="module" src="${assets.entry}"></script>`;
  }
  if (assets.dev) boot.dev = true;

  const html = `<!doctype html>
<html lang="${esc(config.lang ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(head.title ?? "")}</title>
${head.description ? `<meta name="description" content="${esc(head.description)}">\n` : ""}${[...(config.head?.meta ?? []), ...(head.meta ?? [])].map((m) => `<meta${attrs(m)}>`).join("\n")}
${[...(config.head?.links ?? []), ...(head.links ?? [])].map((l) => `<link${attrs(l)}>`).join("\n")}
${assets.css.map((c) => `<link rel="stylesheet" href="${c}">`).join("\n")}
${scripts ? `<link rel="modulepreload" href="${assets.entry}">\n` : ""}${preload.map((p) => `<link rel="modulepreload" href="${p}">`).join("\n")}
</head>
<body>
<div id="__optz">${body}</div>
<script type="application/json" id="__optz_boot">${scriptJson(boot)}</script>
${scripts}
</body>
</html>
`;
  return { kind: "page", html, payload: { data, head } };
}
