import { Link, type Head, type Href, type PageProps } from "optz";
import { docSections, type DocMeta } from "$lib/docs";
import site from "$lib/site";
import { Arrow } from "$components/Icons";

export const loader = () => ({ sections: docSections() });
export const head = (): Head => ({
  title: `Docs | ${site.title}`,
  description: "How to build on optz, how it's made and with what, how fast it is, and how the lab's server runs.",
});

export default function DocsHome({ data }: PageProps<{ sections: { section: string; pages: DocMeta[] }[] }, "/docs">) {
  return (
    <div className="docs-home">
      <div className="docs-heading"><h1>OPTZ documentation</h1>
      <p>
        Build with OPTZ 0.4: HTML-first pages, interactive islands, and optional APIs for accounts, persistent data and live updates. Explore the framework,
        measured tradeoffs, and the lab behind it. Start with the{" "}
        <Link href="/docs/introduction" className="underline decoration-rule underline-offset-4 hover:decoration-ink">
          introduction
        </Link>
        .
      </p></div>
      <div className="docs-start"><div><h2>Your first OPTZ app</h2><p>Install Bun, run the site, and build your first page.</p></div><Link href="/docs/getting-started" className="text-link">Getting started<Arrow /></Link></div>
      <div className="docs-home-sections">
        {data.sections.map((s) => (
          <section key={s.section} aria-label={s.section}>
            <h2>{s.section}</h2>
            <ul>
              {s.pages.map((p) => (
                <li key={p.slug}>
                  <Link href={`/docs/${p.slug}` as Href}>
                    <span>{p.title}</span>
                    <span>{p.description}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
