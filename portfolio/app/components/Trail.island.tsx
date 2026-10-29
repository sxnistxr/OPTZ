import { useEffect, useRef, useState } from "react";
import { Button } from "$components/ui/button";
import { Replay } from "$components/Icons";
import { trailPoint } from "$lib/trail-geometry";
import type { TrailController } from "$lib/trail-scene";

export const hydrate = "visible";
export default function Trail({ mode }: { mode: "flow" | "speed" }) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<TrailController | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "running" | "fallback">("loading");
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let disposed = false;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { setReduced(preference.matches); controller.current?.setReduced(preference.matches); };
    sync(); preference.addEventListener("change", sync);
    // Splits the renderer out of the tiny island entry; docs never request Three.js.
    import("$lib/trail-scene").then(({ createTrail }) => {
      if (disposed || !host.current) return;
      controller.current = createTrail(host.current, mode, preference.matches, (running) => {
        if (!disposed) setState(running ? "running" : "ready");
      }, () => { if (!disposed) setState("fallback"); });
      if (!controller.current) setState("fallback");
    }).catch(() => { if (!disposed) setState("fallback"); });
    return () => { disposed = true; preference.removeEventListener("change", sync); controller.current?.dispose(); controller.current = null; };
  }, [mode]);
  const paths = Array.from({ length: 52 }, (_, lane) => Array.from({ length: 100 }, (_, step) => {
    const p = trailPoint(step / 99, lane / 51, mode);
    return `${step ? "L" : "M"}${p.x.toFixed(1)},${(400 - p.y).toFixed(1)}`;
  }).join(" "));
  return <div className={`trail-scene trail-${mode}`} data-state={state}>
    <div className="trail-viewport" ref={host} aria-hidden="true">
      <svg className="trail-fallback" viewBox="0 0 1000 400" preserveAspectRatio="none" fill="none">
        {paths.map((d,i) => <path key={i} d={d} stroke="currentColor" strokeOpacity={i % 4 === 0 ? .7 : .25} strokeWidth=".8" />)}
      </svg>
    </div>
    <div className="trail-controls site-container"><span>{mode === "speed" ? "A little speed, just for fun." : "A small experiment in motion."}</span>
      <Button variant="outline" disabled={state === "loading" || state === "running" || state === "fallback" || (reduced && mode === "speed")} onClick={() => controller.current?.replay()}><Replay />{state === "fallback" ? "Static preview" : state === "running" ? (mode === "speed" ? "In flight…" : "Reseeding…") : mode === "speed" ? (reduced ? "Reduced motion" : "Send a request") : "Reseed"}</Button>
    </div>
    <span className="sr-only" role="status">{state === "fallback" ? "Animation unavailable. A static trail is shown." : state === "ready" && mode === "speed" ? "Illustrative request complete: 200 OK." : ""}</span>
  </div>;
}
