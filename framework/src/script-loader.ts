// Loads third-party scripts once per page session (shared by <Script> and the islands runtime).
const loaded = new Map<string, Promise<void>>();

export function loadScript(src: string, attrs: Record<string, string> = {}): Promise<void> {
  let p = loaded.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`couldn't load ${src}`));
      document.head.append(s);
    });
    loaded.set(src, p);
  }
  return p;
}

/** Loads the <optz-script> markers under `root` by their strategy. */
export function loadMarkedScripts(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("optz-script").forEach((el) => {
    const src = el.dataset.src;
    if (!src || el.dataset.done) return;
    el.dataset.done = "1";
    const attrs: Record<string, string> = {};
    for (const a of el.getAttributeNames()) if (a.startsWith("data-attr-")) attrs[a.slice(10)] = el.getAttribute(a)!;
    const go = () => loadScript(src, attrs).catch((e) => console.error(e));
    if (el.dataset.strategy === "lazyOnload") {
      const idle = () => (window.requestIdleCallback ?? ((f: () => void) => setTimeout(f, 1)))(go);
      if (document.readyState === "complete") idle();
      else addEventListener("load", idle, { once: true });
    } else go();
  });
}
