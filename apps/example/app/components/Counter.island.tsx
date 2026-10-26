import { useState } from "react";

// An island: the only part of the page that ships JavaScript. Hydrates when scrolled into view.
export const hydrate = "visible";

export default function Counter({ start = 0 }: { start?: number }) {
  const [n, setN] = useState(start);
  return (
    <button className="rounded border px-3 py-1" onClick={() => setN(n + 1)}>
      Clicked {n} times
    </button>
  );
}
