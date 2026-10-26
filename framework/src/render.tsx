// Server-side rendering of one page into a complete HTML document, and the data payload the
// browser fetches when it navigates to the same URL.
import { renderToString } from "react-dom/server";
import { NotFound } from "./index";
import { StaticRouter, type PageState } from "./runtime";
import type { Config, ErrorModule, Head, LayoutModule, LoaderContext, PageModule, Params } from "./types";

export interface RenderInput {
  page: PageModule;
  layouts: LayoutModule[];
  error?: ErrorModule;
  pattern: string;
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
  /** Chunks to preload for this route (its module and layouts). */
  preload: string[];
  dev?: boolean;
}

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

export function mergeHead(input: RenderInput, data: unknown): Head {
  const head: Head = { meta: [], links: [] };
  for (const l of input.layouts) Object.assign(head, stripUndefined(l.head?.({ params: input.params }) ?? {}));
  const page = input.page.head?.(data as never, { params: input.params }) ?? {};
  return { ...head, ...stripUndefined(page) };
}
const stripUndefined = (h: Head) => Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)) as Head;

export type Loaded =
  | { kind: "data"; payload: { data: unknown; head: Head } }
  | { kind: "redirect"; response: Response }
  | { kind: "notFound" };

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

export async function renderPage(input: RenderInput, assets: Assets, config: Config): Promise<Rendered> {
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
  const boot = { pattern: input.pattern, params: input.params, data, ...(assets.dev ? { dev: true } : {}) };
  const html = `<!doctype html>
<html lang="${esc(config.lang ?? "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(head.title ?? "")}</title>
${head.description ? `<meta name="description" content="${esc(head.description)}">\n` : ""}${[...(config.head?.meta ?? []), ...(head.meta ?? [])].map((m) => `<meta${attrs(m)}>`).join("\n")}
${[...(config.head?.links ?? []), ...(head.links ?? [])].map((l) => `<link${attrs(l)}>`).join("\n")}
${assets.css.map((c) => `<link rel="stylesheet" href="${c}">`).join("\n")}
<link rel="modulepreload" href="${assets.entry}">
${assets.preload.map((p) => `<link rel="modulepreload" href="${p}">`).join("\n")}
</head>
<body>
<div id="__optz">${body}</div>
<script>window.__OPTZ__=${scriptJson(boot)}</script>
<script type="module" src="${assets.entry}"></script>
</body>
</html>
`;
  return { kind: "page", html, payload: { data, head } };
}
