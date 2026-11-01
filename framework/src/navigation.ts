// Shared browser transaction policy. Importing it never reads browser globals or loads React.
import { afterNavigation, focusHash, rememberOpener } from "./a11y";

export interface NavigationOptions {
  pop?: boolean;
  replace?: boolean;
  scroll?: boolean;
  refresh?: boolean;
}

type PreparedNavigation = { commit(): void; afterRender?(): void } | { redirect: string };
interface NavigationAdapter {
  prepare(url: URL, options: NavigationOptions, signal: AbortSignal): Promise<PreparedNavigation | null>;
  pending(active: boolean): void;
  afterRender(effect: () => void): void;
  transition?: boolean;
  onNavigate?(url: URL): void;
}

/** One owner for supersession, history and completion, across both rendering adapters. */
export function createNavigation(adapter: NavigationAdapter) {
  let active: AbortController | undefined;
  /** Prepare a page and commit only while current; failed commits recover by document navigation. */
  async function navigate(href: string, options: NavigationOptions = {}): Promise<void> {
    const url = new URL(href, location.href);
    // In-page and full-document moves also supersede unfinished preparation.
    active?.abort();
    const controller = active = new AbortController();
    const current = () => !controller.signal.aborted;
    if (url.origin !== location.origin) return void location.assign(url.href);
    if (!options.pop && !options.refresh && url.pathname === location.pathname && url.search === location.search && url.hash) {
      history.pushState(null, "", url.href);
      focusHash(url.hash);
      adapter.pending(false);
      return;
    }
    if (!options.refresh) rememberOpener();
    adapter.pending(true);
    try {
      const page = await adapter.prepare(url, options, controller.signal);
      if (!current()) return;
      if (!page) return void location.assign(url.href);
      if ("redirect" in page) return await navigate(page.redirect, { replace: true });
      /** Publish history and content together, then schedule guarded post-render effects. */
      const commit = () => {
        if (!current()) return;
        if (!options.pop && !options.refresh) {
          history.replaceState({ ...history.state, scroll: scrollY }, "");
          history[options.replace ? "replaceState" : "pushState"]({ scroll: 0 }, "", url.href);
        }
        page.commit();
        adapter.afterRender(() => {
          if (!current()) return;
          page.afterRender?.();
          if (options.scroll === false || options.refresh) return;
          if (options.pop) scrollTo(0, history.state?.scroll ?? 0);
          else if (!url.hash) scrollTo(0, 0);
          afterNavigation(options.pop ? "" : url.hash);
        });
      };
      const vt = adapter.transition && !options.refresh && document.startViewTransition;
      if (vt && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const transition = vt.call(document, commit);
        // Animation cancellation is harmless; a failed update must reach document recovery.
        await Promise.all([transition.updateCallbackDone, transition.finished.catch(() => {})]);
      } else commit();
    } catch {
      if (current()) {
        // A failed commit may already have published this URL to history. Assigning the
        // same fragment URL only scrolls; reload to replace the partially committed page.
        if (location.href === url.href) location.reload();
        else location.assign(url.href);
      }
      return;
    } finally {
      if (current()) adapter.pending(false);
    }
    if (current() && !options.refresh) adapter.onNavigate?.(url);
  }
  return navigate;
}
