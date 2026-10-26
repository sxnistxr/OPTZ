"use client";

import { useEffect, useState } from "react";
import { duration } from "$lib/format";
import { social } from "$lib/social";

type S = { state: "checking" } | { state: "live"; ms: number; uptime: number } | { state: "down" };

/** Island: times a real request to the engine from the visitor's browser, every 15 s while visible. */
export default function Pulse() {
  const [s, setS] = useState<S>({ state: "checking" });
  useEffect(() => {
    const check = async () => {
      const t0 = performance.now();
      try {
        const d = await social.health();
        const ms = performance.now() - t0;
        setS(d.status === "ok" ? { state: "live", ms, uptime: d.uptime_s } : { state: "down" });
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
    <section aria-label="Live server status" className="mt-10 border-l-2 border-rule pl-5">
      <p className="flex items-center gap-2.5 text-sm text-muted">
        <span className="signal-dot" data-state={s.state === "checking" ? "idle" : s.state} />
        <span>{s.state === "live" ? "Live, timed from your browser" : s.state === "down" ? "The server isn't answering right now" : "Checking the server"}</span>
      </p>
      <p className="mt-2 text-2xl leading-snug tracking-tight md:text-3xl">
        The server behind this page answered in <strong className="font-semibold tabular-nums">{ms}</strong>.
      </p>
      <p className="mt-1 text-muted">
        It has been up for <span className="tabular-nums text-ink">{s.state === "live" ? duration(s.uptime) : s.state === "down" ? "an unknown time" : "…"}</span>, on one CPU core and
        2 GB of memory.
      </p>
    </section>
  );
}
