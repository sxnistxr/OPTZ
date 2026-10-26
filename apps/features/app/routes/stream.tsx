import { Suspense } from "react";

// Dynamic and streamed: the heading goes out at once, each async component when it's ready.
export const config = { render: "dynamic" } as const;

async function Slow({ ms, label }: { ms: number; label: string }) {
  await new Promise((r) => setTimeout(r, ms));
  return <p data-testid={label}>{label} after {ms} ms</p>;
}

export default function Stream() {
  return (
    <>
      <h1 data-testid="stream-head">Streaming</h1>
      <Suspense fallback={<p data-testid="fallback-a">loading a</p>}>
        <Slow ms={300} label="a" />
      </Suspense>
      <Suspense fallback={<p data-testid="fallback-b">loading b</p>}>
        <Slow ms={600} label="b" />
      </Suspense>
    </>
  );
}
