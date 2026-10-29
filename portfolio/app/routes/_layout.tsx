import { Link, useRouter, type Head, type Href } from "optz";
import type { ReactNode } from "react";
import { cn } from "cn";
import { Arrow } from "$components/Icons";
import site from "$lib/site";

export const head = (): Head => ({ title: site.title, description: site.about, openGraph: { siteName: site.name } });
export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useRouter();
  const docs = pathname === "/docs" || pathname.startsWith("/docs/");
  const optz = pathname === "/optz" || docs;
  const landing = pathname === "/" || pathname === "/optz";
  const nav: [Href, string][] = optz
    ? [["/optz", "Overview"], ["/docs", "Docs"], ["/docs/vs-nextjs", "Benchmarks"]]
    : [["/lab", "Projects"], ["/blog", "Writing"], ["/optz", "OPTZ"]];
  const current = nav.filter(([h]) => pathname === h || pathname.startsWith(h + "/")).sort((a,b) => b[0].length - a[0].length)[0]?.[0];
  return (
    <div className={cn("site-shell", landing && "landing-shell", docs && "site-shell-docs")}>
      <a href="#main" className="skip-link">Skip to content</a>
      <div aria-hidden="true" className="navigation-progress" />
      <div className={cn("header-surface", landing && "dark-surface")}>
        <header className="site-header site-container">
          <Link href={optz ? "/optz" : "/"} className={cn("site-brand", optz && "optz-brand")} aria-label={optz ? "OPTZ home" : "DihLabs home"}>{optz ? "OPTZ" : "DihLabs"}<span className="brand-mark" aria-hidden="true">{optz ? "" : "."}</span></Link>
          <nav aria-label="Site" className="site-nav">
            {nav.map(([href,label]) => <Link key={href} href={href} aria-current={href === current ? "page" : undefined}>{label}</Link>)}
            <a href={optz ? site.repo : "https://github.com/sxnistxr"}>GitHub</a>
            {optz && <Link className="nav-back" href="/">DihLabs<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden="true"><path d="M15 5H5v10M5 5l10 10" /></svg></Link>}
          </nav>
        </header>
      </div>
      <main id="main" tabIndex={-1} className={landing ? "landing-main" : cn("site-container", docs ? "docs-main" : "site-main")}>{children}</main>
      <footer className="site-footer site-container">
        <Link href="/" className="footer-brand">DihLabs.</Link>
        <span>Built with curiosity. By {site.author}.</span>
        <a href={optz ? site.repo : "https://github.com/sxnistxr"}>{optz ? "View framework source" : "Find me on GitHub"}<Arrow /></a>
      </footer>
    </div>
  );
}
