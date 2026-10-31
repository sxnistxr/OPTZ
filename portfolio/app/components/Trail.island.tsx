import { useEffect, useRef, useState } from "react";
import { Button } from "$components/ui/button";
import { Replay } from "$components/Icons";
import { TrailLines } from "$components/TrailLines";
import { SpeedLines } from "$components/SpeedLines";
import type { TrailController } from "$lib/trail-scene";

export const hydrate = "visible";
export default function Trail({ mode }: { mode: "flow" | "speed" }) {
  const host = useRef<HTMLDivElement>(null);
  const controller = useRef<TrailController | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "running" | "fallback">("loading");
  const [reduced, setReduced] = useState(false);
  const paused = useRef(false);
  const [isPaused, setPaused] = useState(false);
  useEffect(() => {
    let disposed = false;
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => { setReduced(preference.matches); controller.current?.setReduced(preference.matches); };
    sync(); preference.addEventListener("change", sync);
    // Splits each renderer out of the tiny island entry; docs never request Three.js.
    const onRunning = (running: boolean) => { if (!disposed) setState(running ? "running" : "ready"); };
    const onFailure = () => { if (!disposed) setState("fallback"); };
    (mode === "speed"
      ? import("$lib/speed-scene").then(({ createSpeed }) => !disposed && host.current ? createSpeed(host.current, preference.matches, onRunning, onFailure) : null)
      : import("$lib/trail-scene").then(({ createTrail }) => !disposed && host.current ? createTrail(host.current, preference.matches, onRunning, onFailure) : null)
    ).then((created) => {
      if (disposed) { created?.dispose(); return; }
      controller.current = created || null;
      if (!controller.current) setState("fallback");
    }).catch(() => { if (!disposed) setState("fallback"); });
    return () => { disposed = true; preference.removeEventListener("change", sync); controller.current?.dispose(); controller.current = null; };
  }, [mode]);
  return <div className={`trail-scene trail-${mode}`} data-state={state}>
    <div className="trail-viewport" ref={host} aria-hidden="true">
      {mode === "speed" ? <SpeedLines className="trail-fallback" mark /> : <TrailLines className="trail-fallback" />}
    </div>
    <div className="trail-controls site-container">{mode === "flow" && <span>A small experiment in motion.</span>}
      <div className="trail-actions">
      {!reduced && <Button variant="ghost" size="sm" className="trail-pause" aria-label={isPaused ? "Resume animation" : "Pause animation"} disabled={state === "loading" || state === "fallback"} onClick={() => { paused.current = !paused.current; setPaused(paused.current); controller.current?.setPaused(paused.current); }}><svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">{isPaused ? <path d="m5 3 8 5-8 5V3Z" /> : <path d="M4 3h3v10H4V3Zm5 0h3v10H9V3Z" />}</svg></Button>}
      <Button variant="ghost" size="sm" disabled={state === "loading" || state === "running" || state === "fallback" || isPaused || (reduced && mode === "speed")} onClick={() => controller.current?.replay()}><Replay />{state === "fallback" ? "Static preview" : isPaused ? "Paused" : state === "running" ? (mode === "speed" ? "Serving…" : "Reseeding…") : mode === "speed" ? (reduced ? "Reduced motion" : "Send a request") : "Reseed"}</Button>
      </div>
    </div>
    <span className="sr-only" role="status">{state === "fallback" ? "Animation unavailable. A static trail is shown." : state === "ready" && mode === "speed" ? "Illustrative request served from memory." : ""}</span>
  </div>;
}
