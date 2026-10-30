import { useEffect, useMemo, useRef, useState } from "react";

// Island: searches the docs' titles, sections and headings in the browser. The index is a
// prerendered JSON file (/api/docs), fetched the first time the box is focused.
export const hydrate = "idle";

interface Entry {
  slug: string;
  title: string;
  section: string;
  description: string;
  headings: { id: string; text: string }[];
}
interface Hit {
  href: string;
  title: string;
  context: string;
  score: number;
}

let index: Promise<Entry[]> | null = null;
const load = () => (index ??= fetch("/api/docs").then((r) => r.json() as Promise<{ docs: Entry[] }>).then((d) => d.docs));

function search(docs: Entry[], q: string): Hit[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const has = (s: string) => words.every((w) => s.toLowerCase().includes(w));
  const hits: Hit[] = [];
  for (const d of docs) {
    if (has(d.title)) hits.push({ href: `/docs/${d.slug}`, title: d.title, context: d.section, score: 3 });
    else if (has(`${d.title} ${d.description}`)) hits.push({ href: `/docs/${d.slug}`, title: d.title, context: d.section, score: 1 });
    for (const h of d.headings) if (has(h.text)) hits.push({ href: `/docs/${d.slug}#${h.id}`, title: h.text, context: d.title, score: 2 });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 8);
}

export default function DocsSearch() {
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<Entry[] | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => (docs ? search(docs, q) : []), [docs, q]);

  useEffect(() => {
    // "/" focuses the search box, like most docs sites.
    const onKey = (e: KeyboardEvent) => {
      if (((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !(e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest("input, textarea, select"))))) {
        e.preventDefault();
        input.current?.focus();
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setQ("");
    const nav = (globalThis as { __optz?: { navigate?: (h: string) => unknown } }).__optz?.navigate;
    if (nav) nav(href);
    else location.assign(href);
  };

  return (
    <div className="docs-search relative" role="search">
      <svg className="docs-search-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m13 13 4 4" /></svg>
      <kbd className="docs-search-key" aria-hidden="true">Ctrl K</kbd>
      <label htmlFor="docs-search" className="sr-only">
        Search the docs
      </label>
      <input
        ref={input}
        id="docs-search"
        type="search"
        value={q}
        placeholder="Search docs…"
        autoComplete="off"
        onFocus={() => load().then(setDocs, () => setDocs([]))}
        onChange={(e) => {
          setQ(e.currentTarget.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, hits.length - 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
          else if (e.key === "Enter" && hits[active]) (e.preventDefault(), go(hits[active].href));
          else if (e.key === "Escape") setQ("");
        }}
        role="combobox"
        aria-expanded={!!q && hits.length > 0}
        aria-autocomplete="list"
        aria-controls="docs-search-results"
        aria-activedescendant={q && hits.length ? `docs-hit-${active}` : undefined}
        className="docs-search-input block w-full rounded-md border border-rule bg-paper py-2 placeholder:text-muted focus:border-ink"
      />
      {/* Options are plain (no links inside them): click or Enter opens one. */}
      <ul
        id="docs-search-results"
        role="listbox"
        aria-label="Search results"
        hidden={!q || hits.length === 0}
        className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-md border border-rule bg-paper shadow-lg"
      >
        {q &&
          hits.map((h, i) => (
            <li
              key={h.href}
              id={`docs-hit-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => (setQ(""), go(h.href))}
              className={`block cursor-pointer px-3 py-2 ${i === active ? "bg-panel" : ""}`}
            >
              <span className="block text-[0.92rem] font-medium leading-snug">{h.title}</span>
              <span className="block text-xs text-muted">{h.context}</span>
            </li>
          ))}
      </ul>
      <p role="status" className={q && hits.length === 0 ? "absolute inset-x-0 top-full z-10 mt-1 rounded-md border border-rule bg-paper px-3 py-2 text-sm text-muted shadow-lg" : "sr-only"}>
        {!q ? "" : docs === null ? "Loading the index" : hits.length === 0 ? `Nothing matches "${q}". Try fewer words.` : `${hits.length} result${hits.length === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}
