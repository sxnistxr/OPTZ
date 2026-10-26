import { Link, useRouter, type Href } from "optz";
import type { ReactNode } from "react";
import DocsSearch from "$components/DocsSearch.island";
import { docSections } from "$lib/docs";

// Docs pages: a sidebar with search and every page by section, then the page.
export default function DocsLayout({ children }: { children: ReactNode }) {
  const { pathname } = useRouter();
  return (
    <div className="lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-12">
      <aside className="mb-10 lg:mb-0">
        <div className="lg:sticky lg:top-8">
          <DocsSearch />
          {/* Small screens: the same menu, folded away under the search box. */}
          <details className="mt-3 text-[0.95rem] lg:hidden">
            <summary className="cursor-pointer py-1 text-muted">Browse the docs</summary>
            <div className="mt-3 pl-3">
              <Menu pathname={pathname} />
            </div>
          </details>
          <nav aria-label="Documentation" className="mt-6 hidden text-[0.92rem] lg:block">
            <Menu pathname={pathname} />
          </nav>
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Menu({ pathname }: { pathname: string }) {
  return (
    <>
      {docSections().map((s) => (
        <div key={s.section} className="mb-6">
          <p className="mb-1.5 text-xs font-medium text-muted">{s.section}</p>
          <ul>
            {s.pages.map((p) => {
              const href = `/docs/${p.slug}`;
              const here = pathname === href;
              return (
                <li key={p.slug}>
                  <Link
                    href={href as Href}
                    aria-current={here ? "page" : undefined}
                    className={`-ml-3 block border-l-2 py-1 pl-3 ${here ? "border-signal font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}
                  >
                    {p.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}
