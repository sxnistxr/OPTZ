import { Link, useRouter, type Head, type Href } from "optz";
import type { ReactNode } from "react";
import site from "$lib/site";

const nav: [Href, string][] = [
  ["/", "Home"],
  ["/lab", "Lab"],
  ["/blog", "Writing"],
  ["/docs", "Docs"],
  ["/docs/ai", "AI"],
];

export const head = (): Head => ({ title: site.title, description: site.about, openGraph: { siteName: site.title } });

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useRouter();
  const matches = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  // The longest matching link is current, so /docs/ai marks "AI", not "Docs" too.
  const here = nav.map(([h]) => h).filter(matches).sort((a, b) => b.length - a.length)[0];
  const current = (href: string) => href === here;
  // Docs get a wider shell for their menu, article and "on this page" navigation.
  const docs = pathname === "/docs" || pathname.startsWith("/docs/");
  return (
    <div className={`site-shell${docs ? " site-shell-docs" : ""}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      <div aria-hidden className="navigation-progress" />
      <header className="site-header">
        <Link href="/" className="site-brand">{site.name}<span className="brand-author">by {site.author}</span></Link>
        <nav aria-label="Site" className="site-nav">
          {nav.map(([href, label]) => (
            <Link key={href} href={href} aria-current={current(href) ? "page" : undefined}>{label}</Link>
          ))}
        </nav>
      </header>
      <main id="main" tabIndex={-1} className={docs ? "docs-main" : "site-main"}>{children}</main>
      <footer className="site-footer">
        <span>{site.name} <span className="text-muted">by {site.author}</span></span>
        <a href={site.repo}>View source on GitHub</a>
      </footer>
    </div>
  );
}
