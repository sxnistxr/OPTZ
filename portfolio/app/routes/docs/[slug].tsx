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
  return (
    <article>
      <header className="max-w-[46rem]">
        <p className="text-sm text-muted">{d.section}</p>
        <h1 className="mt-1 text-4xl font-semibold leading-[1.08] tracking-[-0.02em] md:text-5xl">{d.title}</h1>
        {d.description && <p className="mt-4 text-lg leading-relaxed text-muted">{d.description}</p>}
      </header>
      {toc.length > 2 && (
        <nav aria-label="On this page" className="mt-8 max-w-[46rem] border-l-2 border-rule pl-5 text-[0.92rem]">
          <p className="mb-1.5 text-xs font-medium text-muted">On this page</p>
          <ul className="columns-1 gap-8 sm:columns-2">
            {toc.map((t) => (
              <li key={t.id} className="break-inside-avoid py-0.5">
                <a href={`#${t.id}`} className="text-muted hover:text-ink">
                  {t.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <div className="prose-docs mt-10" dangerouslySetInnerHTML={{ __html: d.html }} />
      <footer className="mt-16 max-w-[46rem] border-t border-rule pt-6">
        <p className="text-sm text-muted">
          From{" "}
          <a href={`${site.repo}/blob/${site.branch}/${d.file}`} className="underline decoration-rule underline-offset-4 hover:text-ink">
            {d.file}
          </a>{" "}
          in the repository.
        </p>
        <div className="mt-6 flex justify-between gap-6">
          {d.prev ? (
            <Link href={`/docs/${d.prev.slug}` as Href} className="group">
              <span className="block text-sm text-muted">Previous</span>
              <span className="font-medium group-hover:underline group-hover:decoration-rule group-hover:underline-offset-4">{d.prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {d.next && (
            <Link href={`/docs/${d.next.slug}` as Href} className="group text-right">
              <span className="block text-sm text-muted">Next</span>
              <span className="font-medium group-hover:underline group-hover:decoration-rule group-hover:underline-offset-4">{d.next.title}</span>
            </Link>
          )}
        </div>
      </footer>
    </article>
  );
}
