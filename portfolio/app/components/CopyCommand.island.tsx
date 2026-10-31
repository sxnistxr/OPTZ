import { useEffect, useRef, useState } from "react";

export const hydrate = "visible";

/** A shell command in a pill with a copy button. Without JavaScript the command is still selectable text. */
export default function CopyCommand({ command }: { command: string }) {
  const [label, setLabel] = useState<"Copy" | "Copied" | "Select to copy">("Copy");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setLabel("Copied"); }
    catch { setLabel("Select to copy"); }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLabel("Copy"), 2000);
  };
  return <div className="command-pill">
    <code><span aria-hidden="true">$ </span>{command}</code>
    <button type="button" onClick={copy} aria-label={label === "Copy" ? "Copy command" : label}>
      {label === "Copied"
        ? <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
        : <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" /></svg>}
    </button>
    <span className="sr-only" role="status">{label === "Copy" ? "" : label}</span>
  </div>;
}
