import { Link, notFound, type Head, type Href, type LoaderContext, type PageProps } from "optz";
import { getDoc, listDocs, type Doc, type DocMeta } from "$lib/docs";
import site from "$lib/site";
import DocsTools from "$components/DocsTools.island";
import CopyPage from "$components/CopyPage.island";
import { DocPreview, pagePreviews, type PreviewName } from "$components/DocPreviews";

// One static page per doc, rendered from Markdown at build time.
export const paths = () => listDocs().map((d) => ({ slug: d.slug }));
export const loader = ({ params }: LoaderContext<{ slug: string }>) => {
  const doc = getDoc(params.slug) ?? notFound();
  // The modules overview opens with a card for each module.
  const modules = doc.slug === "modules" ? listDocs().filter((d) => d.section === doc.section && d.slug !== "modules") : [];
  return { ...doc, modules };
};
export const head = (d: Doc): Head => ({
  title: `${d.title} | ${site.title} docs`,
  description: d.description,
  canonical: `/docs/${d.slug}`,
  openGraph: { type: "article" },
});

const dateLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

export default function DocPage({ data: d }: PageProps<Doc & { modules: DocMeta[] }, "/docs/[slug]">) {
  const toc = d.toc.filter((t) => t.depth === 2 || t.depth === 3);
  const sections = toc.filter((t) => t.depth === 2).length;
  const links = toc.map((t) => (
    <li key={t.id} className={t.depth === 3 ? "toc-sub" : undefined}>
      <a href={`#${t.id}`}>{t.text}</a>
    </li>
  ));
  const preview = pagePreviews[d.slug];
  const issue = `${site.repo}/issues/new?title=${encodeURIComponent(`Docs: ${d.title}`)}&body=${encodeURIComponent(`Page: ${site.url}/docs/${d.slug}\n\n`)}`;
  return (
    <div className="docs-page">
      <article className={`docs-article${d.chapter ? " docs-tutorial" : ""}`}>
        <header className="docs-heading">
          <nav aria-label="Breadcrumb" className="docs-breadcrumb"><Link href="/docs">Docs</Link><span aria-hidden="true">/</span><span>{d.section}</span></nav>
          {d.chapter && <div className="docs-chapter">
            <span>Chapter {d.chapter.number} of {d.chapter.of}</span>
            <span className="docs-chapter-track" aria-hidden="true">{Array.from({ length: d.chapter.of }, (_, i) => <i key={i} className={i < d.chapter!.number ? "is-done" : ""} />)}</span>
          </div>}
          <h1>{d.title}</h1>
          {d.description && <p>{d.description}</p>}
          <div className="docs-meta">
            {d.updated && <span>Updated <time dateTime={d.updated}>{dateLabel(d.updated)}</time></span>}
            <CopyPage slug={d.slug} />
            <a className="docs-meta-action" href={`/api/docs-markdown/${d.slug}`}>View as Markdown</a>
          </div>
        </header>
        {preview && <div className="docs-banner"><DocPreview name={preview as PreviewName} /></div>}
        {d.modules.length > 0 && <ul className="docs-module-list">
          {d.modules.map((m) => {
            const name = pagePreviews[m.slug];
            return <li key={m.slug}><Link href={`/docs/${m.slug}` as Href} className="docs-card docs-card-small">
              {name && <div className="docs-card-preview"><DocPreview name={name} /></div>}
              <div className="docs-card-copy"><h3>{m.title}</h3><p>{m.description}</p></div>
            </Link></li>;
          })}
        </ul>}
        {sections > 2 && (
          <details className="toc docs-toc-inline">
            <summary>On this page</summary>
            <ul>{links}</ul>
          </details>
        )}
        <div className="prose-docs" dangerouslySetInnerHTML={{ __html: d.html }} />
        <footer className="docs-footer">
          <nav aria-label="More docs" className="docs-pager">
            {d.prev ? (
              <Link href={`/docs/${d.prev.slug}` as Href}>
                <span>{d.chapter && d.prev.chapter ? `Chapter ${d.prev.chapter.number}` : "Previous"}</span>
                <strong>{d.prev.title}</strong>
              </Link>
            ) : (
              <span />
            )}
            {d.next && (
              <Link href={`/docs/${d.next.slug}` as Href} className="docs-pager-next">
                <span>{d.chapter && d.next.chapter ? `Chapter ${d.next.chapter.number}` : "Next"}</span>
                <strong>{d.next.title}</strong>
              </Link>
            )}
          </nav>
          <p className="docs-edit">
            <a href={`${site.repo}/blob/${site.branch}/${d.file}`}>Edit this page on GitHub</a>
            <a href={issue}>Report a problem with this page</a>
          </p>
        </footer>
      </article>
      {sections > 2 && (
        <aside className="docs-rail">
          <nav aria-label="On this page" className="toc docs-toc">
            <p>On this page</p>
            <ul>{links}</ul>
            <a href="#main" className="docs-top">Back to top</a>
          </nav>
        </aside>
      )}
      <DocsTools />
    </div>
  );
}
