// What a full page load gives assistive technology for free, done again after in-app
// navigation (both the islands HTML swap and the SPA router):
//   - focus moves to the new page's <main> (or the #hash target), so keyboard and screen-reader
//     users start at the content instead of on a link that no longer exists;
//   - the new page's title is announced through a polite live region;
//   - in-page links (#main skip links included) move focus to their target, not just the scroll;
//   - <dialog data-optz-modal> becomes a real modal: showModal() (focus trap, inert page,
//     aria-modal), Escape closes it, and focus returns to the link that opened it.
// Browser-only code, no React.

/** The head tags that belong to a page (replaced on navigation). */
export const PER_PAGE_HEAD =
  'meta[name="description"], meta[name="robots"], meta[name="keywords"], link[rel="canonical"], meta[property^="og:"], meta[property^="article:"], meta[name^="twitter:"], link[rel="alternate"]';

/** Replaces this page's per-page head tags with those in `head` (a parsed document's <head>, or
 *  HTML for its tags). */
export function replaceHeadTags(head: ParentNode | string) {
  const src: ParentNode = typeof head === "string" ? new DOMParser().parseFromString(`<head>${head}</head>`, "text/html").head : head;
  document.head.querySelectorAll(PER_PAGE_HEAD).forEach((el) => el.remove());
  const before = document.head.querySelector('link[rel="stylesheet"]');
  src.querySelectorAll(PER_PAGE_HEAD).forEach((el) => document.head.insertBefore(document.importNode(el, true), before));
}

let region: HTMLElement | null = null;
/** Says `text` to screen readers (a polite live region outside the swapped content). */
export function announce(text: string) {
  if (!region || !region.isConnected) {
    region = document.createElement("div");
    region.id = "optz-announcer";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("aria-atomic", "true");
    region.setAttribute("role", "status");
    region.className = "optz-sr-only";
    document.body.append(region);
  }
  // Cleared first, so the same title twice is still announced.
  region.textContent = "";
  const r = region;
  setTimeout(() => (r.textContent = text), 50);
}

/** Focuses `el` without scrolling, making it focusable for script if it isn't. */
function focusEl(el: HTMLElement) {
  if (!el.matches("a[href], button, input, select, textarea, [tabindex]")) el.setAttribute("tabindex", "-1");
  el.focus({ preventScroll: true });
}

/** The element a #hash names, if any. */
export function hashTarget(hash: string): HTMLElement | null {
  if (!hash || hash === "#") return null;
  let id = hash.slice(1);
  try {
    id = decodeURIComponent(id);
  } catch {}
  return document.getElementById(id) ?? (document.getElementsByName(id)[0] as HTMLElement | undefined) ?? null;
}

/** Scrolls to and focuses a #hash target (an in-page link, a skip link). */
export function focusHash(hash: string): boolean {
  const t = hashTarget(hash);
  if (!t) return false;
  t.scrollIntoView();
  focusEl(t);
  return true;
}

/** The href of the link that opened the last modal: focus returns to it when the modal goes
 *  (the link itself may have been replaced by the swap). */
let restoreHref: string | null = null;
/** The href of the focused link when the current navigation started (the swap replaces it). */
let startedFrom: string | null = null;

/** Call when a navigation starts: remembers which link started it. */
export function rememberOpener() {
  const a = document.activeElement;
  startedFrom = a instanceof HTMLAnchorElement ? a.getAttribute("href") : null;
}

/** After a navigation: focus the hash target or the main content, and announce the page. An
 *  open modal keeps focus; one that just closed hands it back to the link that opened it. */
export function afterNavigation(hash: string) {
  const modal = document.querySelector<HTMLDialogElement>("dialog[data-optz-modal][open]");
  if (modal) {
    announce(modal.getAttribute("aria-label") ?? modal.querySelector("h1, h2, h3")?.textContent ?? document.title);
    return;
  }
  if (restoreHref) {
    const back = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].find((a) => a.getAttribute("href") === restoreHref);
    restoreHref = null;
    if (back) {
      back.focus({ preventScroll: true });
      announce(document.title);
      return;
    }
  }
  if (!focusHash(hash)) {
    const main = document.querySelector<HTMLElement>("main, [role=main]") ?? document.querySelector<HTMLElement>("h1") ?? document.getElementById("__optz");
    if (main) focusEl(main);
  }
  announce(document.title);
}

/** In-page links move focus too (browsers only scroll for non-focusable targets). Runs for
 *  every click, so it also covers real navigations (speculation rules) and no-swap pages. */
export function handleInPageLinks() {
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element).closest?.("a");
    if (!a?.hash || a.target) return;
    const url = new URL(a.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search) return;
    const t = hashTarget(url.hash);
    if (!t) return;
    e.preventDefault();
    if (location.hash !== url.hash) history.pushState(history.state, "", url.href);
    focusHash(url.hash);
  });
}

const opened = new WeakSet<HTMLDialogElement>();
/** Turns <dialog data-optz-modal> under `root` into modals. Escape (and the close button)
 *  goes back, or to data-close-href; focus returns to what had it before. */
export function enhanceDialogs(root: ParentNode, close: (href: string | null) => void) {
  root.querySelectorAll<HTMLDialogElement>("dialog[data-optz-modal]").forEach((d) => {
    if (opened.has(d) || typeof d.showModal !== "function") return;
    opened.add(d);
    const opener = document.activeElement;
    restoreHref = startedFrom ?? (opener instanceof HTMLAnchorElement ? opener.getAttribute("href") : null);
    if (d.open) d.removeAttribute("open");
    d.showModal();
    // The dialog's heading (or the dialog) gets focus, not its close button.
    const first = d.querySelector<HTMLElement>("[autofocus]") ?? d.querySelector<HTMLElement>("h1, h2, h3");
    if (first) focusEl(first);
    const leave = () => close(d.dataset.closeHref ?? null);
    d.addEventListener("cancel", (e) => {
      e.preventDefault();
      leave();
    });
    d.querySelectorAll("[data-optz-close]").forEach((b) => b.addEventListener("click", (e) => (e.preventDefault(), leave())));
  });
}
