// The islands-mode browser runtime: no React, ~2 KB. It hydrates islands (each loads its own
// chunk, which brings React only when the page has an island), and optionally turns same-origin
// link clicks into HTML swaps: fetch the next page, replace #__optz, hydrate its islands.
import { matchSegments, type Segment } from "./match";
import type { Hydrate, Params } from "./types";

type Mount = (el: Element, props: Record<string, unknown>, ctx: IslandCtx) => { unmount(): void };
interface IslandCtx {
  pathname: string;
  params: Params;
  navigate: (href: string) => void;
}
export interface IslandEntry {
  load: () => Promise<{ default: Mount }>;
  hydrate: Hydrate;
}
interface Boot {
  pattern: string;
  params: Params;
  segments?: Segment[];
  dev?: boolean;
}

let roots: { unmount(): void }[] = [];
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
  const params = boot?.segments ? (matchSegments(boot.segments, location.pathname) ?? {}) : (boot?.params ?? {});
  return { pathname: location.pathname, params, navigate };
}

function hydrateAll(registry: Record<string, IslandEntry>, root: ParentNode) {
  const ctx = islandCtx(readBoot(document));
  root.querySelectorAll<HTMLElement>("optz-island").forEach((el) => {
    const entry = registry[el.dataset.id ?? ""];
    if (!entry) return;
    const go = () =>
      entry.load().then((m) => {
        if (el.isConnected) roots.push(m.default(el, JSON.parse(el.dataset.props || "{}"), ctx));
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
}

let registryRef: Record<string, IslandEntry> = {};
let seq = 0;

function fetchHtml(href: string): Promise<string | null> {
  const hit = prefetched.get(href);
  if (hit && Date.now() - hit.at < 30_000) return hit.html;
  const html = fetch(href, { headers: { Accept: "text/html", "X-Optz-Swap": "1" } })
    .then((r) => (r.ok || r.status === 404) && (r.headers.get("content-type") ?? "").includes("text/html") ? r.text() : null)
    .catch(() => null);
  prefetched.set(href, { at: Date.now(), html });
  return html;
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
  prefetched.delete(url.pathname + url.search);
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
  for (const r of roots) r.unmount();
  roots = [];
  if (!opts.pop) {
    history.replaceState({ ...history.state, scroll: scrollY }, "");
    history[opts.replace ? "replaceState" : "pushState"]({ scroll: 0 }, "", url.href);
  }
  document.title = doc.title;
  const desc = doc.querySelector('meta[name="description"]')?.getAttribute("content");
  const mine = document.querySelector('meta[name="description"]');
  if (desc != null && mine) mine.setAttribute("content", desc);
  const boot = doc.getElementById("__optz_boot");
  const myBoot = document.getElementById("__optz_boot");
  if (boot && myBoot) myBoot.textContent = boot.textContent;
  here.replaceChildren(...next.childNodes);
  hydrateAll(registryRef, here);
  if (opts.pop) scrollTo(0, history.state?.scroll ?? 0);
  else if (url.hash) document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView();
  else scrollTo(0, 0);
  dispatchEvent(new CustomEvent("optz:navigate", { detail: { url: url.href } }));
}

function eligible(a: HTMLAnchorElement | null): a is HTMLAnchorElement {
  if (!a || !a.href || a.target && a.target !== "_self" || a.hasAttribute("download") || a.dataset.reload !== undefined) return false;
  const url = new URL(a.href);
  return url.origin === location.origin && !url.pathname.startsWith("/api/") && !/\.\w+$/.test(url.pathname);
}

export function startIslands(registry: Record<string, IslandEntry>, opts: { navigation: boolean; prefetch: boolean }) {
  registryRef = registry;
  hydrateAll(registry, document);
  const boot = readBoot(document);
  if (boot?.dev) liveReload();
  if (!opts.navigation) return;
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

function liveReload() {
  const connect = (wasDown: boolean) => {
    const es = new EventSource("/_optz/dev/events");
    es.onopen = () => wasDown && location.reload();
    es.onerror = () => {
      es.close();
      setTimeout(() => connect(true), 300);
    };
  };
  connect(false);
}
