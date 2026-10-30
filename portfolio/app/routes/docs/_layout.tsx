import { Link, useRouter, type Href } from "optz";
import type { ReactNode } from "react";
import { docSections } from "$lib/docs";

// Docs pages: a sidebar with search and every page by section, then the page.
export default function DocsLayout({ children }: { children: ReactNode }) {
  const { pathname } = useRouter();
  return (
    <div className="docs-layout">
      <aside className="docs-sidebar">
        <div className="docs-sidebar-inner">
          <Link href="/docs" className="docs-overview" aria-current={pathname === "/docs" ? "page" : undefined}><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M3 4.5h6.5V16H3V4.5Zm7.5 0H17V16h-6.5V4.5Z" /></svg>Documentation</Link>
          {/* Small screens: the same menu, folded away under the search box. */}
          <details className="mt-3 text-[0.95rem] lg:hidden">
            <summary className="cursor-pointer py-1 text-muted">Browse the docs</summary>
            <nav aria-label="Documentation menu" className="mt-4">
              <Menu pathname={pathname} />
            </nav>
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
        <div key={s.section} className="docs-nav-group">
          <p className="docs-nav-label">{s.section}</p>
          <ul>
            {s.pages.map((p) => {
              const href = `/docs/${p.slug}`;
              const here = pathname === href;
              return (
                <li key={p.slug}>
                  <Link
                    href={href as Href}
                    aria-current={here ? "page" : undefined}
                    className="docs-nav-link"
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
