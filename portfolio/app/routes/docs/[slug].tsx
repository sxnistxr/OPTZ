import { Link, notFound, type Head, type Href, type LoaderContext, type PageProps } from "optz";
import { getDoc, listDocs, type Doc } from "$lib/docs";
import site from "$lib/site";
import DocsTools from "$components/DocsTools.island";

// One static page per doc, rendered from Markdown at build time.
export const paths = () => listDocs().map((d) => ({ slug: d.slug }));
export const loader = ({ params }: LoaderContext<{ slug: string }>) => getDoc(params.slug) ?? notFound();
export const head = (d: Doc): Head => ({
  title: `${d.title} | ${site.title} docs`,
  description: d.description,
  canonical: `/docs/${d.slug}`,
  openGraph: { type: "article" },
});

export default function DocPage({ data: d }: PageProps<Doc, "/docs/[slug]">) {
  const toc = d.toc.filter((t) => t.depth === 2);
  const links = toc.map((t) => (
    <li key={t.id}>
      <a href={`#${t.id}`}>{t.text}</a>
    </li>
  ));
  return (
    <div className="docs-page">
      <article className="docs-article">
        <header className="docs-heading">
          <nav aria-label="Breadcrumb" className="docs-breadcrumb"><Link href="/docs">Docs</Link><span aria-hidden="true">/</span><span>{d.section}</span></nav>
          <h1>{d.title}</h1>
          {d.description && <p>{d.description}</p>}
        </header>
        {toc.length > 2 && (
          <details className="toc mt-8 border-l border-rule text-sm xl:hidden">
            <summary className="cursor-pointer pl-4 text-muted">On this page</summary>
            <ul className="mt-2">{links}</ul>
          </details>
        )}
        <div className="prose-docs mt-10" dangerouslySetInnerHTML={{ __html: d.html }} />
        <footer className="mt-20 border-t border-rule pt-6">
          <nav aria-label="More docs" className="docs-pager">
            {d.prev ? (
              <Link href={`/docs/${d.prev.slug}` as Href}>
                <span>Previous</span>
                <strong>{d.prev.title}</strong>
              </Link>
            ) : (
              <span />
            )}
            {d.next && (
              <Link href={`/docs/${d.next.slug}` as Href} className="docs-pager-next">
                <span>Next</span>
                <strong>{d.next.title}</strong>
              </Link>
            )}
          </nav>
          <p className="docs-edit">
            <a href={`${site.repo}/blob/${site.branch}/${d.file}`}>Edit this page on GitHub</a>
          </p>
        </footer>
      </article>
      {toc.length > 2 && (
        <aside className="hidden xl:block">
          <nav aria-label="On this page" className="toc docs-toc">
            <p>On this page</p>
            <ul>{links}</ul>
          </nav>
        </aside>
      )}
      <DocsTools />
    </div>
  );
}
