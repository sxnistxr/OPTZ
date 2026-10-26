// The islands-mode browser runtime: no React, ~2 KB. It hydrates islands (each loads its own
// chunk, which brings React only when the page has an island), and optionally turns same-origin
// link clicks into HTML swaps: fetch the next page, replace #__optz, hydrate its islands.
// `refresh()` (after a Server Action revalidates, or `useRouter().refresh()`) re-fetches the
// current page and keeps every island whose props didn't change mounted, state and all.
import { matchSegments, type Segment } from "./match";
import { loadMarkedScripts } from "./script-loader";
import type { LocaleInfo } from "./runtime";
import type { Hydrate, Params } from "./types";

type Mount = (el: Element, props: Record<string, unknown>, ctx: IslandCtx) => { unmount(): void };
interface IslandCtx {
  pathname: string;
  params: Params;
  navigate: (href: string) => void;
  i18n?: LocaleInfo;
}
export interface IslandEntry {
  load: () => Promise<{ default: Mount }>;
  hydrate: Hydrate;
}
interface Boot {
  pattern: string;
  params: Params;
  segments?: Segment[];
  i18n?: LocaleInfo;
  dev?: boolean;
}

const roots = new Map<Element, { unmount(): void }>();
const prefetched = new Map<string, { at: number; html: Promise<string | null> }>();

function readBoot(doc: Document): Boot | null {
  const el = doc.getElementById("__optz_boot");
  try {
    return el ? (JSON.parse(el.textContent || "null") as Boot) : null;
  } catch {
    return null;
  }
}

function islandCtx(boot: Boot | null): IslandCtx {
  // Client-rendered shells are built without params; read them from the URL.
  let path = location.pathname;
  const i18n = boot?.i18n;
  if (i18n) {
    const first = path.split("/")[1];
    if (i18n.locales.includes(first)) path = path.slice(first.length + 1) || "/";
  }
  const params = boot?.segments ? (matchSegments(boot.segments, path) ?? {}) : (boot?.params ?? {});
  return { pathname: location.pathname, params, navigate, i18n };
}

const islandKey = (el: Element) => `${el.getAttribute("data-id")}\n${el.getAttribute("data-props")}`;

function hydrateAll(registry: Record<string, IslandEntry>, root: ParentNode) {
  const ctx = islandCtx(readBoot(document));
  root.querySelectorAll<HTMLElement>("optz-island").forEach((el) => {
    if (roots.has(el) || el.dataset.pending) return;
    const entry = registry[el.dataset.id ?? ""];
    if (!entry) return;
    el.dataset.pending = "1";
    const go = () =>
      entry.load().then((m) => {
        delete el.dataset.pending;
        if (el.isConnected && !roots.has(el)) roots.set(el, m.default(el, JSON.parse(el.dataset.props || "{}"), ctx));
      });
    const when = (el.dataset.hydrate as Hydrate | undefined) ?? entry.hydrate;
    if (when === "visible" && "IntersectionObserver" in window) {
      const io = new IntersectionObserver(
        (es) => {
          if (es.some((e) => e.isIntersecting)) {
            io.disconnect();
            go();
          }
        },
        { rootMargin: "200px" },
      );
      // The wrapper is display:contents (no box of its own), so watch its first child.
      io.observe(el.firstElementChild ?? el);
    } else if (when === "idle") {
      (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200)))(go);
    } else go();
  });
  loadMarkedScripts(root);
}

let registryRef: Record<string, IslandEntry> = {};
let seq = 0;

function fetchHtml(href: string, fresh = false): Promise<string | null> {
  // Intercepting routes answer differently depending on where navigation starts.
  const key = `${location.pathname}|${href}`;
  const hit = fresh ? undefined : prefetched.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.html;
  const html = fetch(href, { headers: { Accept: "text/html", "X-Optz-Swap": "1", "X-Optz-From": location.pathname }, cache: fresh ? "no-store" : "default" })
    .then((r) => ((r.ok || r.status === 404) && (r.headers.get("content-type") ?? "").includes("text/html") ? r.text() : null))
    .catch(() => null);
  if (!fresh) prefetched.set(key, { at: Date.now(), html });
  return html;
}

/** Puts the new page's content in place. Islands with the same id and props as a mounted one
 *  keep the mounted one (and its state); the rest unmount or hydrate. */
function swap(here: HTMLElement, next: HTMLElement, keep: boolean) {
  const kept = new Set<Element>();
  if (keep) {
    const pool = new Map<string, Element[]>();
    for (const el of roots.keys()) if (here.contains(el)) pool.set(islandKey(el), [...(pool.get(islandKey(el)) ?? []), el]);
    next.querySelectorAll("optz-island").forEach((n) => {
      const old = pool.get(islandKey(n))?.shift();
      if (!old) return;
      n.replaceWith(old);
      kept.add(old);
    });
  }
  for (const [el, r] of roots) {
    if (kept.has(el)) continue;
    r.unmount();
    roots.delete(el);
  }
  here.replaceChildren(...next.childNodes);
  hydrateAll(registryRef, here);
}

async function applyHtml(html: string | null, url: URL, opts: { pop?: boolean; replace?: boolean; keep?: boolean; scroll?: boolean }) {
  const doc = html ? new DOMParser().parseFromString(html, "text/html") : null;
  const next = doc?.getElementById("__optz");
  const here = document.getElementById("__optz");
  if (!doc || !next || !here) return void location.assign(url.href);
  // New stylesheets (rare: hashed CSS changes only on deploy) load before the swap.
  const have = new Set([...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((l) => l.href));
  await Promise.all(
    [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
      .filter((l) => !have.has(l.href))
      .map((l) => new Promise((r) => document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: l.href, onload: r, onerror: r })))),
  );
  if (!opts.pop && !opts.keep) {
    history.replaceState({ ...history.state, scroll: scrollY }, "");
    history[opts.replace ? "replaceState" : "pushState"]({ scroll: 0 }, "", url.href);
  }
  document.title = doc.title;
  document.documentElement.lang = doc.documentElement.lang;
  // Per-page head tags follow the page: description, canonical, Open Graph, Twitter, hreflang.
  const perPage = 'meta[name="description"], meta[name="robots"], meta[name="keywords"], link[rel="canonical"], meta[property^="og:"], meta[property^="article:"], meta[name^="twitter:"], link[rel="alternate"]';
  document.head.querySelectorAll(perPage).forEach((el) => el.remove());
  const before = document.head.querySelector('link[rel="stylesheet"]');
  doc.head.querySelectorAll(perPage).forEach((el) => document.head.insertBefore(document.importNode(el, true), before));
  const boot = doc.getElementById("__optz_boot");
  const myBoot = document.getElementById("__optz_boot");
  if (boot && myBoot) myBoot.textContent = boot.textContent;
  swap(here, next, !!opts.keep);
  if (opts.scroll === false) return;
  if (opts.pop) scrollTo(0, history.state?.scroll ?? 0);
  else if (url.hash) document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();
  else scrollTo(0, 0);
}

export async function navigate(href: string, opts: { pop?: boolean; replace?: boolean } = {}) {
  const url = new URL(href, location.href);
  if (url.origin !== location.origin) return void location.assign(url.href);
  if (!opts.pop && url.pathname === location.pathname && url.search === location.search && url.hash) {
    history.pushState(null, "", url.href);
    return void document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();
  }
  const id = ++seq;
  document.documentElement.classList.add("optz-navigating");
  const html = await fetchHtml(url.pathname + url.search);
  if (id !== seq) return;
  document.documentElement.classList.remove("optz-navigating");
  prefetched.delete(`${location.pathname}|${url.pathname + url.search}`);
  // A short cross-fade where the browser supports same-document view transitions.
  const vt = (document as { startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<void> } }).startViewTransition;
  if (vt && !matchMedia("(prefers-reduced-motion: reduce)").matches) await vt.call(document, () => applyHtml(html, url, opts)).finished.catch(() => {});
  else await applyHtml(html, url, opts);
  dispatchEvent(new CustomEvent("optz:navigate", { detail: { url: url.href } }));
}

/** Re-fetches the current page and updates it in place, keeping unchanged islands mounted. */
export async function refresh() {
  const id = ++seq;
  prefetched.clear();
  const url = new URL(location.href);
  const html = await fetchHtml(url.pathname + url.search, true);
  if (id !== seq) return;
  await applyHtml(html, url, { keep: true, scroll: false });
}

function eligible(a: HTMLAnchorElement | null): a is HTMLAnchorElement {
  if (!a || !a.href || (a.target && a.target !== "_self") || a.hasAttribute("download") || a.dataset.reload !== undefined) return false;
  const url = new URL(a.href);
  return url.origin === location.origin && !url.pathname.startsWith("/api/") && !url.pathname.startsWith("/_optz/") && !/\.\w+$/.test(url.pathname);
}

/** Chromium with speculation rules: the server's Speculation-Rules header prerenders the next
 *  page on hover, so a plain navigation is instant (and gets a CSS view transition). */
const speculates = () => typeof HTMLScriptElement !== "undefined" && (HTMLScriptElement as { supports?: (t: string) => boolean }).supports?.("speculationrules") === true;

export function startIslands(registry: Record<string, IslandEntry>, opts: { navigation: boolean; prefetch: boolean; speculation?: boolean }) {
  registryRef = registry;
  (globalThis as { __optz?: unknown }).__optz = { navigate: (h: string) => (opts.navigation ? navigate(h) : location.assign(h)), refresh };
  hydrateAll(registry, document);
  const boot = readBoot(document);
  if (boot?.dev) import("./dev-client").then((m) => m.connect({ refresh, roots, registry: () => registryRef }));
  if (!opts.navigation) return;
  // The browser prerenders links itself: let navigations happen (no swap, no fetch prefetch).
  if (opts.speculation && speculates()) return;
  history.scrollRestoration = "manual";
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.("a");
    if (!eligible(a)) return;
    e.preventDefault();
    navigate(a.href);
  });
  addEventListener("popstate", () => navigate(location.href, { pop: true }));
  if (opts.prefetch) {
    const pre = (e: Event) => {
      const a = (e.target as Element).closest?.("a");
      if (eligible(a)) {
        const u = new URL(a.href);
        if (u.pathname !== location.pathname) fetchHtml(u.pathname + u.search);
      }
    };
    document.addEventListener("mouseover", pre, { passive: true });
    document.addEventListener("focusin", pre);
    document.addEventListener("touchstart", pre, { passive: true });
  }
}
