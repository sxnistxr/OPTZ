import { useRef, useState, type KeyboardEvent } from "react";

export const hydrate = "visible";

/** `code` is highlighted markup; `bytes` is a hex dump for wide and for narrow windows. */
export type BuildFile = { name: string; encoding: string; code?: string; bytes?: [wide: string, narrow: string] };

const FOLDER = "M2 4.5h4l1.5 1.5H14v6.5H2z";
const FILE = "M4 2h5l3 3v9H4zM9 2v3h3";

function Glyph({ d }: { d: string }) {
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}

/** The build output for one page. Choosing a file shows its real contents and the request that receives it. */
export default function BuildFiles({ files }: { files: BuildFile[] }) {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const file = files[selected];
  const choose = (index: number) => {
    const next = (index + files.length) % files.length;
    setSelected(next);
    tabs.current[next]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = { ArrowDown: selected + 1, ArrowRight: selected + 1, ArrowUp: selected - 1, ArrowLeft: selected - 1, Home: 0, End: files.length - 1 }[event.key];
    if (move === undefined) return;
    event.preventDefault();
    choose(move);
  };
  return <>
    <div className="workspace-tabs"><span>dist / static</span><span>hello / {file.name}</span></div>
    <div className="build-workspace-body">
      <div className="workspace-files">
        <ul>{["_optz", "assets", "hello"].map(dir => <li key={dir}><Glyph d={FOLDER} />{dir}</li>)}</ul>
        <div role="tablist" aria-label="Files built for /hello" onKeyDown={onKeyDown}>
          {files.map((f, i) => <button key={f.name} ref={el => { tabs.current[i] = el; }} type="button" role="tab" id={`build-file-${i}`} aria-selected={i === selected} aria-controls="build-file-panel" tabIndex={i === selected ? 0 : -1} onClick={() => setSelected(i)}>
            <Glyph d={FILE} />{f.name}
          </button>)}
        </div>
      </div>
      <div className="build-file-panel" role="tabpanel" id="build-file-panel" aria-labelledby={`build-file-${selected}`} tabIndex={0}>
        {file.code
          ? <pre className="prose-docs feature-code"><code dangerouslySetInnerHTML={{ __html: file.code }} /></pre>
          : <pre className="feature-code build-file-bytes"><span className="bytes-wide">{file.bytes?.[0]}</span><span className="bytes-narrow">{file.bytes?.[1]}</span></pre>}
      </div>
    </div>
    <div className="workspace-output">
      <span className="workspace-request"><span>GET /hello</span><span>accept-encoding: {file.encoding}</span></span>
      <strong>200 OK<svg className="workspace-streak" viewBox="0 0 40 16" aria-hidden="true"><path d="M2 8h36M10 13h22M16 3h14" /></svg></strong>
      <span className="workspace-check"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>Sent {file.name} from memory.</span>
    </div>
  </>;
}
