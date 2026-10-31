import { useEffect, useRef, useState } from "react";

export const hydrate = "idle";

type Label = "Copy page" | "Copied" | "Couldn't copy";

/** Copies the page's Markdown source, for pasting into an AI assistant or notes. */
export default function CopyPage({ slug }: { slug: string }) {
  const [label, setLabel] = useState<Label>("Copy page");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      const res = await fetch(`/api/docs-markdown/${slug}`);
      if (!res.ok) throw new Error(String(res.status));
      await navigator.clipboard.writeText(await res.text());
      setLabel("Copied");
    } catch {
      setLabel("Couldn't copy");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLabel("Copy page"), 2000);
  };
  return <>
    <button type="button" className="docs-meta-action" onClick={copy}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" /></svg>
      {label}
    </button>
    <span className="sr-only" role="status">{label === "Copy page" ? "" : label}</span>
  </>;
}
