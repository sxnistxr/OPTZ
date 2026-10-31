import { useRef, useState } from "react";
import { uploadFile } from "@sxnistxr/optz-uploads/client";
export const hydrate = "idle";
export default function UploadPanel() {
  const file = useRef<HTMLInputElement>(null), active = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false), [progress, setProgress] = useState(0), [message, setMessage] = useState(""), [resumeId, setResumeId] = useState("");
  return <form onSubmit={async event => {
    event.preventDefault(); const selected = file.current?.files?.[0]; if (!selected || running) return;
    setRunning(true); setMessage(""); setProgress(0); active.current = new AbortController();
    try { await uploadFile(selected, { endpoint: "/api/uploads", resumeId: resumeId || undefined, signal: active.current.signal, onProgress: (bytes, total) => setProgress(bytes / total) }); setMessage("File approved and stored privately."); setResumeId(""); }
    catch (error) { const id = (error as { uploadId?: string }).uploadId; if (id) setResumeId(id); setMessage("Upload stopped. Select the same file to retry; matching checksummed parts can resume."); }
    finally { setRunning(false); }
  }}><label>Choose a file (up to 100 MiB)<input ref={file} type="file" required disabled={running} accept="text/plain,image/png,image/jpeg,application/pdf" /></label><label>Existing upload ID (optional)<input value={resumeId} onChange={e => setResumeId(e.currentTarget.value)} disabled={running} /></label><progress aria-label="Upload progress" max={1} value={progress} /><p role="status">{message}</p><button disabled={running}>{resumeId ? "Resume upload" : "Upload privately"}</button>{running && <button type="button" onClick={() => active.current?.abort()}>Stop upload</button>}</form>;
}
