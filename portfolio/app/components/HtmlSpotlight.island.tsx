import { useEffect, useRef } from "react";
import { BINARY_COLUMNS, binaryGrid, htmlBytes } from "$lib/html-bytes";

export const hydrate = "visible";

export default function HtmlSpotlightController() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const frame = marker.current?.closest<HTMLElement>(".html-spotlight");
    const viewport = frame?.querySelector<HTMLElement>(".spotlight-viewport");
    const toggle = frame?.querySelector<HTMLDetailsElement>(".spotlight-toggle");
    const source = frame?.querySelector<HTMLElement>(".spotlight-source");
    const rendered = frame?.querySelector<HTMLElement>(".spotlight-rendered");
    const binary = frame?.querySelector<HTMLElement>(".spotlight-binary");
    if (!frame || !viewport || !toggle || !source || !rendered || !binary) return;
    if (!CSS.supports("mask-image", "radial-gradient(black, transparent)")) return;

    const bytes = htmlBytes(source.textContent ?? "");
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const summary = toggle.querySelector("summary")!;
    let rect = viewport.getBoundingClientRect();
    let x = rect.width / 2, y = rect.height / 2;
    let active = false, dragging = false, visible = true, raf = 0, lastOffset = -1;

    const stop = () => { cancelAnimationFrame(raf); raf = 0; };
    const radius = () => {
      const size = toggle.open ? Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y)) + 30 : active ? 110 : 0;
      viewport.style.setProperty("--spot-radius", `${size}px`);
    };
    const draw = () => {
      raf = 0;
      viewport.style.setProperty("--spot-x", `${x}px`);
      viewport.style.setProperty("--spot-y", `${y}px`);
      if (!preference.matches && active && !toggle.open) {
        const offset = Math.floor(y / 18) * BINARY_COLUMNS + Math.floor(x / 10);
        if (offset !== lastOffset) { binary.textContent = binaryGrid(bytes, offset); lastOffset = offset; }
      }
    };
    const queue = () => { if (!raf && visible && !document.hidden) raf = requestAnimationFrame(draw); };
    const point = (event: PointerEvent) => {
      x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      queue();
    };
    const enter = (event: PointerEvent) => {
      if (toggle.open || event.pointerType === "touch") return;
      rect = viewport.getBoundingClientRect(); active = true; point(event); radius();
    };
    const leave = () => { active = false; dragging = false; stop(); radius(); };
    const move = (event: PointerEvent) => { if (active && (event.pointerType !== "touch" || dragging)) point(event); };
    const down = (event: PointerEvent) => {
      if (toggle.open || event.pointerType !== "touch") return;
      rect = viewport.getBoundingClientRect(); dragging = true; active = true; point(event); radius();
    };
    const up = (event: PointerEvent) => { if (event.pointerType === "touch") leave(); };
    const sync = () => {
      rect = viewport.getBoundingClientRect();
      summary.setAttribute("aria-expanded", String(toggle.open));
      rendered.inert = toggle.open;
      source.inert = !toggle.open;
      source.setAttribute("aria-hidden", String(!toggle.open));
      rendered.setAttribute("aria-hidden", String(toggle.open));
      if (toggle.open) stop();
      radius();
    };
    const suspended = () => { if (document.hidden) leave(); };
    const resized = new ResizeObserver(() => { rect = viewport.getBoundingClientRect(); radius(); });
    const intersection = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; if (!visible) leave(); });
    const scrolled = () => { if (active) { rect = viewport.getBoundingClientRect(); leave(); } };
    frame.dataset.enhanced = "true";
    draw(); sync();
    viewport.addEventListener("pointerenter", enter);
    viewport.addEventListener("pointerleave", leave);
    viewport.addEventListener("pointermove", move);
    viewport.addEventListener("pointerdown", down);
    viewport.addEventListener("pointerup", up);
    viewport.addEventListener("pointercancel", leave);
    toggle.addEventListener("toggle", sync);
    preference.addEventListener("change", sync);
    document.addEventListener("visibilitychange", suspended);
    window.addEventListener("scroll", scrolled, { passive: true, capture: true });
    resized.observe(viewport); intersection.observe(viewport);
    return () => {
      stop(); resized.disconnect(); intersection.disconnect();
      viewport.removeEventListener("pointerenter", enter);
      viewport.removeEventListener("pointerleave", leave);
      viewport.removeEventListener("pointermove", move);
      viewport.removeEventListener("pointerdown", down);
      viewport.removeEventListener("pointerup", up);
      viewport.removeEventListener("pointercancel", leave);
      toggle.removeEventListener("toggle", sync);
      preference.removeEventListener("change", sync);
      document.removeEventListener("visibilitychange", suspended);
      window.removeEventListener("scroll", scrolled, true);
      delete frame.dataset.enhanced;
      source.inert = rendered.inert = false;
      source.removeAttribute("aria-hidden"); rendered.removeAttribute("aria-hidden");
      summary.removeAttribute("aria-expanded");
    };
  }, []);
  return <span className="spotlight-controller" ref={marker} aria-hidden="true" />;
}
