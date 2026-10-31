import { useEffect } from "react";

export const hydrate = "idle";

export default function DocsTools() {
  useEffect(() => {
    let disposed = false;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const cleanups: (() => void)[] = [];
    for (const pre of document.querySelectorAll<HTMLElement>(".prose-docs pre")) {
      const toolbar = document.createElement("span");
      toolbar.className = "code-toolbar";
      const language = document.createElement("span");
      const lang = pre.dataset.lang || "text";
      language.textContent = ({ sh: "Shell", bash: "Shell", ts: "TypeScript", tsx: "TSX", js: "JavaScript", json: "JSON", sql: "SQL", rust: "Rust", yaml: "YAML", toml: "TOML", html: "HTML", css: "CSS", text: "Plain text" } as Record<string, string>)[lang] || lang;
      // A block with a file name shows the name; the language is obvious from it.
      if (pre.dataset.title) {
        language.textContent = pre.dataset.title;
        language.className = "code-toolbar-title";
      }
      toolbar.append(language);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "code-copy";
      button.textContent = "Copy";
      button.setAttribute("aria-label", "Copy code");
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(pre.querySelector("code")?.textContent || "");
          if (disposed) return;
          button.textContent = "Copied";
        } catch {
          if (disposed) return;
          button.textContent = "Select to copy";
        }
        button.setAttribute("aria-label", button.textContent);
        const timer = setTimeout(() => { button.textContent = "Copy"; button.setAttribute("aria-label", "Copy code"); timers.delete(timer); }, 2000);
        timers.add(timer);
      };
      button.addEventListener("click", copy);
      toolbar.append(button);
      pre.prepend(toolbar);
      cleanups.push(() => { button.removeEventListener("click", copy); toolbar.remove(); });
    }
    const headings = Array.from(document.querySelectorAll<HTMLElement>(".prose-docs :is(h2, h3)[id]"));
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".toc a"));
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = headings[0]?.id;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= 150) current = heading.id;
        else break;
      }
      for (const link of links) {
        if (decodeURIComponent(link.hash.slice(1)) === current) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      }
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onScroll);
    return () => { disposed = true; cleanups.forEach(cleanup => cleanup()); timers.forEach(clearTimeout); cancelAnimationFrame(frame); removeEventListener("scroll", onScroll); removeEventListener("resize", onScroll); };
  }, []);
  return null;
}
