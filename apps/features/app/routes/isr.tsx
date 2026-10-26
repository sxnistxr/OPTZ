import type { PageProps } from "optz";
import { rendered } from "$lib/store";

// Incremental static regeneration: built at build time, rebuilt in the background at most every 2 s.
export const revalidate = 2;
export const tags = ["clock"];
export const loader = () => ({ at: new Date().toISOString(), n: rendered("isr") });

export default function Isr({ data }: PageProps<{ at: string; n: number }>) {
  return (
    <p data-testid="isr">
      render {data.n} at {data.at}
    </p>
  );
}
