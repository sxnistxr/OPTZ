import type { Head } from "optz";
import { LabList } from "$components/Lab";
import lab from "$lib/lab";
import site from "$lib/site";

export const head = (): Head => ({
  title: `Lab | ${site.title}`,
  description: "What's being tried in the lab: SDXL, image and video generation, LLMs, and fast software on small machines.",
});

export default function Lab() {
  const exploring = lab.filter((x) => x.status !== "shipped");
  const shipped = lab.filter((x) => x.status === "shipped");
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-[-0.02em] md:text-5xl">Lab</h1>
      <p className="mt-4 max-w-[36rem] text-lg leading-relaxed">
        Things I'm trying for fun. Some turn into tools, some into notes, some go nowhere. Each one gets written up in Writing when there's something worth
        reading.
      </p>
      <section className="mt-14" aria-labelledby="exploring">
        <h2 id="exploring" className="mb-4 text-sm font-medium text-muted">
          Exploring
        </h2>
        <LabList items={exploring} detail />
      </section>
      <section className="mt-14" aria-labelledby="shipped">
        <h2 id="shipped" className="mb-4 text-sm font-medium text-muted">
          Shipped
        </h2>
        <LabList items={shipped} detail />
      </section>
    </>
  );
}
