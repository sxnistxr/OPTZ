import { useEffect, useState } from "react";
import { api } from "optz";
import { duration } from "$lib/format";

type S = { state: "checking" } | { state: "live"; ms: number; uptime: number; mib: number } | { state: "down" };

/** Island: times a real request to this site's server from the visitor's browser, every 15 s while visible. */
export default function Pulse() {
  const [s, setS] = useState<S>({ state: "checking" });
  useEffect(() => {
    const check = async () => {
      const t0 = performance.now();
      try {
        const d = await api("/api/status", { query: { t: Date.now() } });
        setS({ state: "live", ms: performance.now() - t0, uptime: d.uptimeSeconds, mib: d.rssMiB });
      } catch {
        setS({ state: "down" });
      }
    };
    check();
    const t = setInterval(() => document.visibilityState === "visible" && check(), 15000);
    return () => clearInterval(t);
  }, []);

  const ms = s.state === "live" ? `${s.ms < 10 ? s.ms.toFixed(1) : Math.round(s.ms)} ms` : s.state === "down" ? "no time" : "…";
  return (
    <section aria-label="Live server status" className="server-status">
      <p className="server-response">
        <span className="signal-dot" data-state={s.state === "checking" ? "idle" : s.state} />
        <span role="status">{s.state === "live" ? <>Server online <span className="server-latency">{ms} response</span></> : s.state === "down" ? "Server status unavailable" : "Checking server status"}</span>
      </p>
      <p className="server-details">
        {s.state === "live" ? <>{duration(s.uptime)} uptime <span aria-hidden="true">/</span> {s.mib} MB memory <span aria-hidden="true">/</span> One CPU core</> : "Timed from your browser"}
      </p>
    </section>
  );
}
