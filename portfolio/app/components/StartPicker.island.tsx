import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Arrow } from "$components/Icons";

export const hydrate = "visible";

/** `lines` is each command as highlighted markup; `commands` is the same text, for copying. */
export type StartOption = { title: string; text: string; commands: string[]; lines: string[]; guide: string; href: string };

type CopyLabel = "Copy commands" | "Copied" | "Select to copy";

/** Pick a starting point; the terminal shows the commands that start it, ready to copy. */
export default function StartPicker({ options }: { options: StartOption[] }) {
  const [selected, setSelected] = useState(0);
  const [label, setLabel] = useState<CopyLabel>("Copy commands");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const option = options[selected];
  const select = (index: number) => {
    setSelected(index);
    setLabel("Copy commands");
    clearTimeout(timer.current);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = { ArrowDown: selected + 1, ArrowRight: selected + 1, ArrowUp: selected - 1, ArrowLeft: selected - 1, Home: 0, End: options.length - 1 }[event.key];
    if (move === undefined) return;
    event.preventDefault();
    const next = (move + options.length) % options.length;
    select(next);
    tabs.current[next]?.focus();
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(option.commands.join("\n")); setLabel("Copied"); }
    catch { setLabel("Select to copy"); }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setLabel("Copy commands"), 2000);
  };
  return <div className="start-picker">
    <div className="start-options" role="tablist" aria-label="Starting points" onKeyDown={onKeyDown}>
      {options.map((o, i) => <button key={o.title} ref={el => { tabs.current[i] = el; }} type="button" role="tab" id={`start-option-${i}`} aria-selected={i === selected} aria-controls="start-terminal" tabIndex={i === selected ? 0 : -1} onClick={() => select(i)}>
        <span className="start-option-title">{o.title}</span>
        <span className="start-option-text">{o.text}</span>
      </button>)}
    </div>
    <div className="start-terminal" id="start-terminal" role="tabpanel" aria-labelledby={`start-option-${selected}`}>
      <div className="start-terminal-bar">
        <span>Terminal</span>
        <button type="button" onClick={copy}>
          {label === "Copied"
            ? <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7" /></svg>
            : <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 3.5v-.5A1.5 1.5 0 0 0 9 1.5H4A1.5 1.5 0 0 0 2.5 3v5A1.5 1.5 0 0 0 4 9.5h.5" /></svg>}
          {label}
        </button>
        <span className="sr-only" role="status">{label === "Copy commands" ? "" : label}</span>
      </div>
      <pre className="prose-docs feature-code start-commands"><code>{option.lines.map((line, i) => <span key={`${selected}-${i}`} className="start-line" dangerouslySetInnerHTML={{ __html: line }} />)}</code></pre>
      <a className="text-link start-guide" href={option.href}>{option.guide}<Arrow /></a>
    </div>
  </div>;
}
