// Dev-only browser code (its own chunk, never in production): keeps the page in sync with the
// dev server without losing state. When the server comes back after a change, it announces the
// new build; the page then
//   - swaps stylesheets whose URL changed (no flash, no reload),
//   - hot-swaps the code of mounted islands whose chunk changed (React Fast Refresh: their
//     state survives),
//   - re-renders the page's server HTML in place, keeping islands mounted.
// SPA mode, or anything that can't be patched, falls back to a reload.

export interface DevCtx {
  refresh: () => Promise<void>;
  roots?: Map<Element, { unmount(): void }>;
  registry?: () => Record<string, { load: () => Promise<unknown> }>;
}

interface Hello {
  build: number;
  mode: "islands" | "spa";
  islands: Record<string, string>;
  css: string[];
}

const REFRESH = "/assets/dev-vendor/" + "refresh.js";

function bootBuild(): unknown {
  try {
    return JSON.parse(document.getElementById("__optz_boot")?.textContent || "null")?.dev;
  } catch {
    return null;
  }
}

function swapCss(prev: string[], next: string[]) {
  prev.forEach((href, i) => {
    const to = next[i];
    if (!to || to === href) return;
    const old = document.querySelector<HTMLLinkElement>(`link[rel="stylesheet"][href="${href}"]`);
    if (!old) return;
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href: to });
    link.onload = () => old.remove();
    old.after(link);
  });
}

async function apply(ctx: DevCtx, prev: Hello, next: Hello) {
  if (next.mode !== "islands" || prev.mode !== "islands") return location.reload();
  swapCss(prev.css, next.css);
  const changed = Object.keys(next.islands).filter((id) => prev.islands[id] !== next.islands[id]);
  const reg = ctx.registry?.() ?? {};
  for (const id of changed) if (reg[id]) reg[id].load = () => import(/* @vite-ignore */ next.islands[id]);
  const mounted = new Set([...(ctx.roots?.keys() ?? [])].map((el) => el.getAttribute("data-id")));
  const hot = changed.filter((id) => mounted.has(id));
  if (hot.length) {
    try {
      // Importing the new chunks registers the new component versions; then React swaps them in.
      await Promise.all(hot.map((id) => import(/* @vite-ignore */ next.islands[id])));
      const { Refresh } = (await import(/* @vite-ignore */ REFRESH)) as { Refresh: { performReactRefresh(): unknown } };
      Refresh.performReactRefresh();
    } catch (e) {
      console.warn("optz: hot update failed, reloading", e);
      return location.reload();
    }
  }
  await ctx.refresh();
  console.info(`optz: updated in place${hot.length ? ` (hot: ${hot.join(", ")})` : ""}`);
}

export function connect(ctx: DevCtx) {
  const loaded = bootBuild();
  let last: Hello | null = null;
  let queue = Promise.resolve();
  const open = () => {
    const es = new EventSource("/_optz/dev/events");
    es.addEventListener("hello", (e) => {
      const h = JSON.parse((e as MessageEvent).data) as Hello;
      const prev = last;
      last = h;
      // First contact: nothing to do if the page came from this very build.
      if (!prev) {
        if (h.build !== loaded) location.reload();
        return;
      }
      if (h.build !== prev.build) queue = queue.then(() => apply(ctx, prev, h));
    });
    es.addEventListener("reload", () => location.reload());
    es.onerror = () => {
      es.close();
      setTimeout(open, 250);
    };
  };
  open();
}
