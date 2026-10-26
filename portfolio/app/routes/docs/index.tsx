import { Link, type Head, type Href, type PageProps } from "optz";
import { docSections, type DocMeta } from "$lib/docs";
import site from "$lib/site";

export const loader = () => ({ sections: docSections() });
export const head = (): Head => ({
  title: `Docs | ${site.title}`,
  description: "How to build on optz, how it's made and with what, how fast it is, and how the lab's server runs.",
});

export default function DocsHome({ data }: PageProps<{ sections: { section: string; pages: DocMeta[] }[] }, "/docs">) {
  return (
    <>
      <h1 className="text-4xl font-semibold tracking-[-0.02em] md:text-5xl">Docs</h1>
      <p className="mt-4 max-w-[40rem] text-lg leading-relaxed">
        Everything in this repository: the optz framework this site runs on, how it's built and with what, how fast it is and why, the Rust engine, and how
        it all deploys to a $1.50 server. Start with the{" "}
        <Link href="/docs/introduction" className="underline decoration-rule underline-offset-4 hover:decoration-ink">
          introduction
        </Link>
        .
      </p>
      <div className="mt-14 grid max-w-[64rem] gap-x-14 gap-y-14 md:grid-cols-2">
        {data.sections.map((s) => (
          <section key={s.section} aria-label={s.section}>
            <h2 className="mb-3 text-sm font-medium text-muted">{s.section}</h2>
            <ul className="space-y-5">
              {s.pages.map((p) => (
                <li key={p.slug}>
                  <Link href={`/docs/${p.slug}` as Href} className="group block">
                    <span className="font-semibold tracking-tight group-hover:underline group-hover:decoration-rule group-hover:underline-offset-4">{p.title}</span>
                    <span className="mt-1 block text-[0.95rem] leading-relaxed text-muted line-clamp-2">{p.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
