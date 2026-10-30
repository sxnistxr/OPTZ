import { useEffect, useState } from "react";
import { api } from "optz";
import { duration } from "$lib/format";

type S = { state: "checking" } | { state: "live"; ms: number; uptime: number; mib: number } | { state: "down" };

/** Island: times a real request to this site's server from the visitor's browser, every 15 s while visible. */
export default function Pulse() {
  const [s, setS] = useState<S>({ state: "checking" });
  useEffect(() => {
    let disposed = false;
    let request: AbortController | null = null;
    const check = async () => {
      if (disposed || request || document.hidden) return;
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 8000);
      const t0 = performance.now();
      try {
        const d = await api("/api/status", { query: { t: Date.now() }, signal: request.signal });
        if (!d?.ok || !Number.isFinite(d.uptimeSeconds) || !Number.isFinite(d.rssMiB)) throw new Error("Invalid status");
        if (!disposed) setS({ state: "live", ms: performance.now() - t0, uptime: d.uptimeSeconds, mib: d.rssMiB });
      } catch {
        if (!disposed) setS({ state: "down" });
      } finally {
        clearTimeout(timeout);
        request = null;
      }
    };
    check();
    const t = setInterval(() => document.visibilityState === "visible" && check(), 15000);
    document.addEventListener("visibilitychange", check);
    return () => { disposed = true; clearInterval(t); request?.abort(); document.removeEventListener("visibilitychange", check); };
  }, []);

  const ms = s.state === "live" ? `${s.ms < 10 ? s.ms.toFixed(1) : Math.round(s.ms)} ms` : "—";
  return (
    <section aria-label="Live server status" className="server-status">
      <div className="server-connection">
        <p className="server-response"><span className="signal-dot" data-state={s.state === "checking" ? "idle" : s.state} aria-hidden="true" /><span role="status">{s.state === "live" ? "Server online" : s.state === "down" ? "Connection unavailable" : "Connecting to server"}</span></p>
        <p className="server-caption">{s.state === "down" ? "Retrying every 15 seconds" : "Live check from your browser"}</p>
      </div>
      <dl className="server-metrics">
        <div><dt>Round trip</dt><dd>{ms}</dd></div>
        <div><dt>Uptime</dt><dd>{s.state === "live" ? duration(s.uptime) : "—"}</dd></div>
        <div><dt>Memory</dt><dd>{s.state === "live" ? `${s.mib} MiB` : "—"}</dd></div>
      </dl>
    </section>
  );
}
