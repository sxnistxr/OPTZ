// Server-side rendering of one page into a complete HTML document (static pages, cached
// pages) or a stream (dynamic pages: the shell, layouts and _loading fallbacks go out first,
// async components and Suspense boundaries stream in as they finish), plus the data payload
// the browser fetches when it navigates to the same URL (SPA mode).
import type { ComponentType, ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { prerender } from "react-dom/static";
import type { Segment } from "./match";
import { DEFAULT_OG_SIZE, type OgModule } from "./og-types";
import { ImageSizesContext } from "./image-component";
import { NotFound } from "./index";
import { StaticRouter, type LocaleInfo, type PageState } from "./runtime";
import type { ErrorModule, Head, LayoutModule, LoaderContext, PageModule, Params, RenderMode, ResolvedConfig } from "./types";

/** A parallel route slot, resolved for this URL. */
export interface SlotInput {
  page: PageModule;
  params: Params;
  data?: unknown;
}

export interface RenderInput {
  page: PageModule;
  layouts: LayoutModule[];
  error?: ErrorModule;
  loading?: { default: ComponentType<{ params: Params }> };
  /** Per layout index: slot name -> what it shows (null: nothing). */
  slots?: Array<Record<string, SlotInput | null> | undefined>;
  pattern: string;
  segments?: Segment[];
  render?: RenderMode;
  /** The public path, locale prefix included. */
  pathname: string;
  params: Params;
  /** Skip the loader (client-rendered shells). */
  skipLoader?: boolean;
  /** URL of this page's Open Graph image, if it has one. */
  og?: string;
  /** The registered image producer's size; omitted means DEFAULT_OG_SIZE. */
  ogSize?: OgModule["size"];
  /** URL base used by headTags when resolving relative metadata URLs. */
  metadataBase?: string;
  i18n?: LocaleInfo;
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
  /** Font files to preload. */
  fonts?: string[];
  dev?: boolean;
  /** Dev: the build's id, so the browser can tell what changed after a rebuild. */
  build?: number;
}

export type Loaded =
  | { kind: "data"; payload: { data: unknown; head: Head } }
  | { kind: "redirect"; response: Response }
  | { kind: "notFound" };

export type Rendered =
  | { kind: "page"; html: string; payload: { data: unknown; head: Head }; status: number }
  | { kind: "stream"; stream: ReadableStream<Uint8Array>; nonce: string; status: number }
  | { kind: "redirect"; response: Response }
  | { kind: "notFound" };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
/** JSON that is safe inside a <script> element. */
export const scriptJson = (v: unknown) => JSON.stringify(v ?? null).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const attrs = (o: Record<string, string | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => ` ${k}="${esc(v!)}"`)
    .join("");

/** Copy defined properties so omitted child metadata cannot erase inherited values. */
const stripUndefined = <T extends object>(h: T): T => Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)) as T;

/**
 * Resolve layout metadata in nesting order, then apply the page's metadata.
 * Open Graph and Twitter fields inherit individually; explicit image arrays replace
 * inherited arrays. A generated PNG supplies image metadata only when images are absent.
 */
export function mergeHead(input: RenderInput, data: unknown): Head {
  const locale = input.ctx.locale;
  /** Resolve the selected Twitter image, including Open Graph and generated fallbacks. */
  const selectedImage = (head: Head): string | undefined => {
    const og = head.openGraph?.images?.[0];
    const url = head.twitter?.images?.[0] ?? (typeof og === "string" ? og : og?.url)
      ?? (head.openGraph?.images === undefined ? input.og : undefined);
    return url && input.metadataBase ? new URL(url, input.metadataBase).href : url;
  };
  /** Inherit social fields, retaining alt text only while its selected image is unchanged. */
  const merge = (parent: Head, child: Head): Head => {
    const merged: Head = {
      ...parent, ...stripUndefined(child),
      ...(parent.openGraph || child.openGraph ? { openGraph: { ...parent.openGraph, ...stripUndefined(child.openGraph ?? {}) } } : {}),
      ...(parent.twitter || child.twitter ? { twitter: { ...parent.twitter, ...stripUndefined(child.twitter ?? {}) } } : {}),
    };
    if (merged.twitter && child.twitter?.imageAlt === undefined && selectedImage(parent) !== selectedImage(merged)) {
      delete merged.twitter.imageAlt;
    }
    return merged;
  };
  let out: Head = { meta: [], links: [] };
  for (const l of input.layouts) out = merge(out, l.head?.({ params: input.params, locale }) ?? {});
  out = merge(out, input.page.head?.(data as never, { params: input.params, locale }) ?? {});
  if (input.og) {
    out.openGraph = { ...out.openGraph, images: out.openGraph?.images ?? [{ url: input.og, ...(input.ogSize ?? DEFAULT_OG_SIZE), type: "image/png", alt: out.title }] };
    out.twitter = { card: "summary_large_image", ...out.twitter };
  }
  return out;
}

/** The <head> tags for a page's merged head. Relative URLs become absolute with site.url. */
export function headTags(head: Head, config: ResolvedConfig, pathname: string, i18n?: LocaleInfo): string {
  const base = config.site?.url;
  const abs = (u: string) => (base ? new URL(u, base).href : u);
  const t: string[] = [`<title>${esc(head.title ?? "")}</title>`];
  const meta = (o: Record<string, string | undefined>) => t.push(`<meta${attrs(o)}>`);
  const link = (o: Record<string, string | undefined>) => t.push(`<link${attrs(o)}>`);
  if (head.description) meta({ name: "description", content: head.description });
  if (head.keywords?.length) meta({ name: "keywords", content: head.keywords.join(", ") });
  if (head.robots) {
    const r = head.robots;
    meta({ name: "robots", content: typeof r === "string" ? r : `${r.index === false ? "noindex" : "index"}, ${r.follow === false ? "nofollow" : "follow"}` });
  }
  if (head.themeColor) meta({ name: "theme-color", content: head.themeColor });
  if (head.canonical) link({ rel: "canonical", href: abs(head.canonical) });
  const og = head.openGraph;
  if (og) {
    const p = (k: string, v?: string) => v !== undefined && meta({ property: `og:${k}`, content: v });
    p("title", og.title ?? head.title);
    p("description", og.description ?? head.description);
    p("type", og.type ?? "website");
    p("url", abs(og.url ?? head.canonical ?? pathname));
    p("site_name", og.siteName);
    p("locale", og.locale ?? i18n?.locale);
    for (const img of og.images ?? []) {
      const i = typeof img === "string" ? { url: img } : img;
      p("image", abs(i.url));
      if (abs(i.url).startsWith("https://")) p("image:secure_url", abs(i.url));
      p("image:type", i.type);
      if (i.width) p("image:width", String(i.width));
      if (i.height) p("image:height", String(i.height));
      if (i.alt) p("image:alt", i.alt);
    }
    if (og.publishedTime) meta({ property: "article:published_time", content: og.publishedTime });
    for (const a of og.authors ?? []) meta({ property: "article:author", content: a });
  }
  const tw = head.twitter;
  if (tw || og) {
    const n = (k: string, v?: string) => v !== undefined && meta({ name: `twitter:${k}`, content: v });
    n("card", tw?.card ?? "summary");
    n("site", tw?.site);
    n("creator", tw?.creator);
    n("title", tw?.title ?? og?.title ?? head.title);
    n("description", tw?.description ?? og?.description ?? head.description);
    const img = tw?.images?.[0] ?? (og?.images?.[0] && (typeof og.images[0] === "string" ? og.images[0] : og.images[0].url));
    if (img) {
      n("image", abs(img));
      const ogImage = og?.images?.[0];
      n("image:alt", tw?.imageAlt ?? (typeof ogImage === "object" && abs(img) === abs(ogImage.url) ? ogImage.alt : undefined));
    }
  }
  for (const [lang, href] of Object.entries(head.alternates?.languages ?? {})) link({ rel: "alternate", hreflang: lang, href: abs(href) });
  for (const [type, href] of Object.entries(head.alternates?.types ?? {})) link({ rel: "alternate", type, href: abs(href) });
  for (const m of [...(config.head?.meta ?? []), ...(head.meta ?? [])]) meta(m);
  for (const l of [...(config.head?.links ?? []), ...(head.links ?? [])]) link(l);
  return t.join("\n");
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

async function slotNodes(input: RenderInput): Promise<PageState["slots"]> {
  if (!input.slots) return undefined;
  return Promise.all(
    input.slots.map(async (s) => {
      if (!s) return undefined;
      const out: Record<string, ReactNode> = {};
      for (const [name, v] of Object.entries(s)) {
        if (!v) {
          out[name] = null;
          continue;
        }
        const data = v.page.loader ? await v.page.loader({ ...input.ctx, params: v.params }) : null;
        const C = v.page.default as ComponentType<{ data: unknown; params: Params; locale?: string }>;
        out[name] = <C data={data} params={v.params} locale={input.ctx.locale} />;
      }
      return out;
    }),
  );
}

/** A thrown redirect() or notFound() during rendering, wherever it happened. */
function control(e: unknown): Extract<Loaded, { kind: "redirect" | "notFound" }> | null {
  if (e instanceof Response) return { kind: "redirect", response: e };
  if (e instanceof NotFound) return { kind: "notFound" };
  return null;
}

export interface RenderOptions {
  /** Stream the response (dynamic pages). Default: render it whole. */
  stream?: boolean;
}

export async function renderPage(input: RenderInput, assets: Assets, config: ResolvedConfig, opts: RenderOptions = {}): Promise<Rendered> {
  // A loader that throws is a page error like a render error: _error.tsx shows it (status 500).
  let loaded: Loaded;
  let loaderError: unknown;
  try {
    loaded = await loadData(input);
  } catch (e) {
    if (!input.error) throw e;
    console.error("optz: loader error:", e);
    loaderError = e;
    let head: Head = {};
    try {
      head = mergeHead(input, null);
    } catch {}
    loaded = { kind: "data", payload: { data: null, head } };
  }
  if (loaded.kind !== "data") return loaded;
  const { data, head } = loaded.payload;
  const state: PageState = {
    pathname: input.pathname,
    params: input.params,
    data,
    Page: input.page.default as PageState["Page"],
    layouts: input.layouts.map((l) => l.default),
    ErrorView: input.error?.default,
    Loading: input.loading?.default,
    slots: await slotNodes(input),
    i18n: input.i18n,
  };
  const islandsMode = config.client.mode === "islands";
  const lang = input.ctx.locale ?? config.lang ?? "en";

  const boot: Record<string, unknown> = islandsMode ? { pattern: input.pattern, params: input.params } : { pattern: input.pattern, params: input.params, data };
  if (islandsMode && input.render === "client" && input.segments) boot.segments = input.segments;
  if (input.i18n) boot.i18n = input.i18n;
  if (assets.dev) boot.dev = assets.build ?? true;

  const fontLinks = (assets.fonts ?? []).map((f) => `<link rel="preload" href="${f}" as="font" type="font/woff2" crossorigin>`).join("\n");
  const docHead = (scriptsInHead: string, preload: string[]) => `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${headTags(head, config, input.pathname, input.i18n)}
${fontLinks}${assets.css.map((c) => `<link rel="stylesheet" href="${c}">`).join("\n")}
${preload.map((p) => `<link rel="modulepreload" href="${p}">`).join("\n")}${scriptsInHead}
</head>
<body>
<div id="__optz">`;

  if (loaderError !== undefined) return renderError(input, state, loaderError, docHead, boot, assets, islandsMode, config);

  // ---- streamed: the document head goes out at once, React's output follows ----------------
  if (opts.stream) {
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    let late: Extract<Loaded, { kind: "redirect" | "notFound" }> | null = null;
    let reactStream: ReadableStream<Uint8Array>;
    try {
      reactStream = await renderToReadableStream(<ImageSizesContext.Provider value={config.images.sizes}><StaticRouter state={state} /></ImageSizesContext.Provider>, {
        nonce,
        onError(e) {
          const c = control(e);
          if (c) late ??= c;
          else console.error("optz: render error:", e);
        },
      });
    } catch (e) {
      const c = control(e);
      if (c) return c;
      if (!input.error) throw e;
      return renderError(input, state, e, docHead, boot, assets, islandsMode, config);
    }
    // The browser entry is a deferred module script, so it runs after the whole stream is in.
    const entry = `\n<script type="module" src="${assets.entry}"></script>`;
    const enc = new TextEncoder();
    const start = enc.encode(docHead(entry, islandsMode ? [] : assets.preload));
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(start);
        const reader = reactStream.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        // A redirect thrown after the first bytes were sent: tell the browser to go there.
        const tail = late?.kind === "redirect" ? `<meta http-equiv="refresh" content="0;url=${esc(late.response.headers.get("Location") ?? "/")}">` : "";
        controller.enqueue(enc.encode(`</div>${tail}\n<script type="application/json" id="__optz_boot">${scriptJson(boot)}</script>\n</body>\n</html>\n`));
        controller.close();
      },
    });
    return { kind: "stream", stream, nonce, status: 200 };
  }

  // ---- whole: wait for everything, including async components and Suspense ---------------
  let body: string;
  let thrown: Extract<Loaded, { kind: "redirect" | "notFound" }> | null = null;
  try {
    const { prelude } = await prerender(<ImageSizesContext.Provider value={config.images.sizes}><StaticRouter state={state} /></ImageSizesContext.Provider>, {
      onError(e) {
        const c = control(e);
        if (c) thrown ??= c;
        else console.error("optz: render error:", e);
      },
    });
    body = await new Response(prelude).text();
  } catch (e) {
    const c = control(e);
    if (c) return c;
    if (!input.error) throw e;
    return renderError(input, state, e, docHead, boot, assets, islandsMode, config);
  }
  if (thrown) return thrown;
  return { kind: "page", ...assemble(body, docHead, boot, assets, islandsMode, config), payload: { data, head }, status: 200 };
}

function assemble(body: string, docHead: (s: string, p: string[]) => string, boot: Record<string, unknown>, assets: Assets, islandsMode: boolean, config: ResolvedConfig) {
  let scripts = "";
  let preload: string[];
  if (islandsMode) {
    const used = [...new Set([...body.matchAll(/<optz-island data-id="([^"]+)"/g)].map((m) => m[1]))];
    preload = used.map((id) => assets.islands?.[id]).filter((u): u is string => !!u);
    // A page with no islands or scripts needs no JS, unless HTML-swap navigation is on.
    if (body.includes("<optz-island") || body.includes("<optz-script") || config.client.navigation || assets.dev) scripts = `<script type="module" src="${assets.entry}"></script>`;
  } else {
    preload = assets.preload;
    scripts = `<script type="module" src="${assets.entry}"></script>`;
  }
  const html = `${docHead(scripts ? `\n<link rel="modulepreload" href="${assets.entry}">` : "", preload)}${body}</div>
<script type="application/json" id="__optz_boot">${scriptJson(boot)}</script>
${scripts}
</body>
</html>
`;
  return { html };
}

/** The page threw while rendering: render the nearest _error.tsx in its place (status 500). */
async function renderError(
  input: RenderInput,
  state: PageState,
  error: unknown,
  docHead: (s: string, p: string[]) => string,
  boot: Record<string, unknown>,
  assets: Assets,
  islandsMode: boolean,
  config: ResolvedConfig,
): Promise<Rendered> {
  // React's onError has already logged it. In production the page gets a generic error with a
  // digest (logged next to the real one) instead of a message that could leak internals.
  const View = input.error!.default;
  const real = error instanceof Error ? error : new Error(String(error));
  let err = real;
  if (!assets.dev) {
    const digest = (crypto.randomUUID?.() ?? String(Date.now())).slice(0, 8);
    console.error(`optz: page error ${digest}: ${real.message}`);
    err = Object.assign(new Error("Something went wrong."), { digest });
  }
  const failed: PageState = { ...state, Loading: undefined, Page: () => <View error={err} params={input.params} /> };
  const { prelude } = await prerender(<ImageSizesContext.Provider value={config.images.sizes}><StaticRouter state={failed} /></ImageSizesContext.Provider>);
  const body = await new Response(prelude).text();
  return { kind: "page", ...assemble(body, docHead, boot, assets, islandsMode, config), payload: { data: null, head: {} }, status: 500 };
}
