import { Link, notFound, type Head, type Href, type LoaderContext, type PageProps } from "optz";
import { getDoc, listDocs, type Doc } from "$lib/docs";
import site from "$lib/site";

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
    <div className="xl:grid xl:grid-cols-[minmax(0,48rem)_12rem] xl:gap-14">
      <article className="min-w-0">
        <header>
          <p className="text-sm text-muted">{d.section}</p>
          <h1 className="mt-2 text-4xl font-semibold leading-[1.1] tracking-[-0.025em] md:text-[2.75rem]">{d.title}</h1>
          {d.description && <p className="mt-4 max-w-[60ch] text-lg leading-relaxed text-muted">{d.description}</p>}
        </header>
        {toc.length > 2 && (
          <details className="toc mt-8 border-l border-rule text-[0.92rem] xl:hidden">
            <summary className="cursor-pointer pl-4 text-muted">On this page</summary>
            <ul className="mt-2">{links}</ul>
          </details>
        )}
        <div className="prose-docs mt-10" dangerouslySetInnerHTML={{ __html: d.html }} />
        <footer className="mt-20 border-t border-rule pt-6">
          <nav aria-label="More docs" className="grid gap-4 sm:grid-cols-2">
            {d.prev ? (
              <Link href={`/docs/${d.prev.slug}` as Href} className="group rounded-md border border-rule px-4 py-3 hover:border-ink">
                <span className="block text-sm text-muted">Previous</span>
                <span className="font-medium text-ink">{d.prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {d.next && (
              <Link href={`/docs/${d.next.slug}` as Href} className="group rounded-md border border-rule px-4 py-3 text-right hover:border-ink">
                <span className="block text-sm text-muted">Next</span>
                <span className="font-medium text-ink">{d.next.title}</span>
              </Link>
            )}
          </nav>
          <p className="mt-6 text-sm text-muted">
            Edit{" "}
            <a href={`${site.repo}/blob/${site.branch}/${d.file}`} className="underline decoration-rule underline-offset-4 hover:text-ink">
              {d.file}
            </a>{" "}
            on GitHub.
          </p>
        </footer>
      </article>
      {toc.length > 2 && (
        <aside className="hidden xl:block">
          <nav aria-label="On this page" className="toc sticky top-8 border-l border-rule text-[0.88rem]">
            <p className="mb-2 pl-4 text-xs font-medium text-muted">On this page</p>
            <ul>{links}</ul>
          </nav>
        </aside>
      )}
    </div>
  );
}
