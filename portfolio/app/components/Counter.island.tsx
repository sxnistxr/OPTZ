import { useState } from "react";

export const hydrate = "visible";

/** The one interactive part of the example page: the only component on it that ships JavaScript. */
export default function Counter({ start }: { start: number }) {
  const [ideas, setIdeas] = useState(start);
  return <div className="island-frame">
    <span className="island-label">Counter.island.tsx</span>
    <div className="island-counter">
      <p aria-live="polite" aria-atomic="true">Ideas so far <b>{ideas}</b></p>
      <button type="button" className="island-action" onClick={() => setIdeas(n => n + 1)}>Add one</button>
    </div>
  </div>;
}
