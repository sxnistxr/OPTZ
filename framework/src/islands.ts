// The islands-mode browser runtime: no React, ~2 KB. It hydrates islands (each loads its own
// chunk, which brings React only when the page has an island), and optionally turns same-origin
// link clicks into HTML swaps: fetch the next page, replace #__optz, hydrate its islands.
// `refresh()` (after a Server Action revalidates, or `useRouter().refresh()`) re-fetches the
// current page and keeps every island whose props didn't change mounted, state and all.
import { enhanceDialogs, handleInPageLinks, replaceHeadTags } from "./a11y";
import { matchSegments, type Segment } from "./match";
import { createNavigation } from "./navigation";
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
const prefetched = new Map<string, { at: number; size: number; html: Promise<string | null> }>();
function trimPrefetch() {
  const now = Date.now();
  for (const [key, entry] of prefetched) if (now - entry.at >= 30_000) prefetched.delete(key);
  let size = [...prefetched.values()].reduce((n, entry) => n + entry.size, 0);
  for (const [key, entry] of prefetched) {
    if (prefetched.size <= 32 && size <= 2_000_000) break;
    prefetched.delete(key);
    size -= entry.size;
  }
}

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
  // Escape or a close button: back to where the modal was opened from (or its close href).
  enhanceDialogs(root, (href) => (href ? navigate(href) : history.length > 1 ? history.back() : navigate("/")));
}

let registryRef: Record<string, IslandEntry> = {};

function fetchHtml(href: string, mode: "prefetch" | "navigate" | "refresh" = "prefetch"): Promise<string | null> {
  trimPrefetch();
  // Intercepting routes answer differently depending on where navigation starts.
  const key = `${location.pathname}|${href}`;
  // Hover results deduplicate prefetches only. A click must validate current content,
  // including responses marked private/no-store and changes since the hover.
  const hit = mode === "prefetch" ? prefetched.get(key) : undefined;
  if (hit && Date.now() - hit.at < 30_000) return hit.html;
  const html = fetch(href, { headers: { Accept: "text/html", "X-Optz-Swap": "1", "X-Optz-From": location.pathname }, cache: mode === "refresh" ? "no-store" : "no-cache" })
    .then((r) => ((r.ok || r.status === 404) && (r.headers.get("content-type") ?? "").includes("text/html") ? r.text() : null))
    .catch(() => null);
  if (mode === "prefetch") {
    const entry = { at: Date.now(), size: 0, html };
    prefetched.set(key, entry);
    trimPrefetch();
    void html.then((value) => {
      if (prefetched.get(key) !== entry) return;
      if (value === null) prefetched.delete(key);
      else entry.size = value.length;
      trimPrefetch();
    });
  }
  return html;
}

/** Puts the new page's content in place. Islands with the same id and props as a mounted one
 *  keep the mounted one (and its state); the rest unmount or hydrate. */
function swap(here: HTMLElement, next: HTMLElement, keep: boolean) {
  const focused = keep && document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
  // Moving a retained island through the parsed document temporarily detaches its focus.
  if (focused?.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
}

export const navigate = createNavigation({
  transition: true,
  onNavigate: (url) => dispatchEvent(new CustomEvent("optz:navigate", { detail: { url: url.href } })),
  pending: (active) => document.documentElement.classList.toggle("optz-navigating", active),
  afterRender: (effect) => effect(),
  async prepare(url, options, signal) {
    if (options.refresh) prefetched.clear();
    const key = `${location.pathname}|${url.pathname + url.search}`;
    const html = await fetchHtml(url.pathname + url.search, options.refresh ? "refresh" : "navigate");
    if (signal.aborted) return null;
    prefetched.delete(key);
    const doc = html ? new DOMParser().parseFromString(html, "text/html") : null;
    const next = doc?.getElementById("__optz");
    const here = document.getElementById("__optz");
    if (!doc || !next || !here) return null;
    // Prepare styles before the transaction can commit; supersession is checked centrally.
    const have = new Set([...document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')].map((l) => l.href));
    await Promise.all(
      [...doc.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')]
        .filter((l) => !have.has(l.href))
        .map((l) => new Promise((r) => document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: l.href, onload: r, onerror: r })))),
    );
    return { commit() {
      document.title = doc.title;
      document.documentElement.lang = doc.documentElement.lang;
      replaceHeadTags(doc.head);
      const boot = doc.getElementById("__optz_boot");
      const myBoot = document.getElementById("__optz_boot");
      if (boot && myBoot) myBoot.textContent = boot.textContent;
      swap(here, next, !!options.refresh);
    } };
  },
});

/** Re-fetches the current page, keeping unchanged islands mounted and focus in place. */
export function refresh() {
  return navigate(location.href, { refresh: true });
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
  // Skip links and other in-page links move focus, however the page navigates.
  handleInPageLinks();
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
