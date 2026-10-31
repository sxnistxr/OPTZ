import { Link, type Head, type Href, type PageProps } from "optz";
import { docSections, type DocMeta } from "$lib/docs";
import site from "$lib/site";
import { Arrow } from "$components/Icons";
import { DocPreview, type PreviewName } from "$components/DocPreviews";

type Card = { slug: string; preview: PreviewName; title?: string; text?: string };

const start: Card[] = [
  { slug: "getting-started", preview: "quickstart", title: "Quickstart", text: "Create an app and run it locally. You'll have a page in the browser in a few commands." },
  { slug: "learn-create", preview: "learn", title: "Learn OPTZ", text: "Build a small reading-list app, one concept per chapter, from first page to deploy." },
  { slug: "framework", preview: "framework", text: "Every routing, rendering, data and configuration option in one place." },
];
const build: Card[] = [
  { slug: "full-stack", preview: "full-stack" },
  { slug: "authentication", preview: "authentication" },
  { slug: "deployment", preview: "deployment", title: "Deploy", text: "Run your build as a Bun server, a single executable, an edge worker or static files." },
  { slug: "ai", preview: "ai" },
];
const modules: Card[] = ["doppler", "uploads", "status-pages", "analytics", "databases", "cloudflare"].map((slug) => ({ slug, preview: slug as PreviewName }));

type Sections = ReturnType<typeof docSections>;
export const loader = () => ({ sections: docSections() });
export const head = (): Head => ({ canonical: "/docs",
  title: "OPTZ documentation | DihLabs",
  description: "Learn OPTZ, a React framework for Bun: a guided first app, the framework reference, full-stack guides, optional modules and deployment.",
});

function DocCard({ card, pages, size = "large" }: { card: Card; pages: Map<string, DocMeta>; size?: "large" | "small" }) {
  const page = pages.get(card.slug)!;
  return <Link href={`/docs/${card.slug}` as Href} className={`docs-card docs-card-${size}`}>
    <div className="docs-card-preview"><DocPreview name={card.preview} /></div>
    <div className="docs-card-copy"><h3>{card.title ?? page.title}</h3><p>{card.text ?? page.description}</p></div>
  </Link>;
}

export default function DocsHome({ data }: PageProps<{ sections: Sections }, "/docs">) {
  const pages = new Map(data.sections.flatMap((s) => s.pages.map((p) => [p.slug, p] as const)));
  const learn = data.sections.find((s) => s.kind === "tutorial");
  return (
    <div className="docs-home">
      <header className="docs-home-intro">
        <h1>Build with OPTZ</h1>
        <p>A React framework for Bun. Pages are HTML before anyone asks for them, and only the parts you mark as islands ship JavaScript. Start with the quickstart, or learn it step by step.</p>
      </header>

      <section aria-labelledby="docs-start">
        <h2 id="docs-start" className="docs-home-title">Start here</h2>
        <div className="docs-card-grid docs-card-grid-3">{start.map((card) => <DocCard key={card.slug} card={card} pages={pages} />)}</div>
      </section>

      {learn && <section className="docs-learn" aria-labelledby="docs-learn">
        <div className="docs-learn-intro">
          <h2 id="docs-learn" className="docs-home-title">Your first project, step by step</h2>
          <p>Seven short chapters. Each one adds a working feature to the same app and explains the idea behind it.</p>
          <Link href={`/docs/${learn.pages[0].slug}` as Href} className="text-link">Start chapter 1<Arrow /></Link>
        </div>
        <ol className="docs-learn-path">
          {learn.pages.map((p) => <li key={p.slug}><Link href={`/docs/${p.slug}` as Href}><span className="docs-learn-number">{p.chapter?.number}</span><span><strong>{p.title}</strong><span>{p.description}</span></span></Link></li>)}
        </ol>
      </section>}

      <section aria-labelledby="docs-build">
        <h2 id="docs-build" className="docs-home-title">Build more</h2>
        <div className="docs-card-grid docs-card-grid-2">{build.map((card) => <DocCard key={card.slug} card={card} pages={pages} />)}</div>
      </section>

      <section aria-labelledby="docs-modules">
        <div className="docs-home-section-top"><h2 id="docs-modules" className="docs-home-title">Optional modules</h2><Link href="/docs/modules" className="text-link">How modules work<Arrow /></Link></div>
        <div className="docs-card-grid docs-card-grid-3">{modules.map((card) => <DocCard key={card.slug} card={card} pages={pages} size="small" />)}</div>
      </section>

      <section aria-labelledby="docs-all">
        <h2 id="docs-all" className="docs-home-title">All documentation</h2>
        <div className="docs-home-sections">
          {data.sections.map((s) => (
            <section key={s.section} aria-label={s.section}>
              <h3>{s.section}</h3>
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
      </section>
    </div>
  );
}
