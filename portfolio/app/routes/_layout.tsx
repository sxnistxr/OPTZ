import { Link, useRouter, type Head, type Href } from "optz";
import type { ReactNode } from "react";
import { cn } from "cn";
import { Arrow } from "$components/Icons";
import OptzLogo from "$components/OptzLogo";
import DihLabsLogo from "$components/DihLabsLogo";
import ThemeToggle from "$components/ThemeToggle";
import DocsSearch from "$components/DocsSearch.island";
import site from "$lib/site";

export const head = (): Head => ({ title: site.title, description: site.about, openGraph: { siteName: site.name } });
export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useRouter();
  const docs = pathname === "/docs" || pathname.startsWith("/docs/");
  const optz = pathname === "/optz" || docs;
  const landing = pathname === "/" || pathname === "/optz";
  const nav: [Href, string][] = optz
    ? [["/optz", "Overview"], ["/docs", "Docs"], ["/docs/vs-nextjs", "Benchmarks"]]
    : [["/lab", "Projects"], ["/blog", "Writing"]];
  const current = nav.filter(([h]) => pathname === h || pathname.startsWith(h + "/")).sort((a,b) => b[0].length - a[0].length)[0]?.[0];
  return (
    <div className={cn("site-shell", landing && "landing-shell", docs && "site-shell-docs")}>
      <script src="/site.js" />
      <a href="#main" className="skip-link">Skip to content</a>
      <div aria-hidden="true" className="navigation-progress" />
      <div className="header-surface">
        <header className="site-header site-container">
          <div className="header-brand"><Link href={optz ? "/optz" : "/"} className={cn("site-brand", optz && "optz-brand")} aria-label={optz ? "OPTZ home" : "DihLabs home"}>{optz ? <OptzLogo /> : <DihLabsLogo />}</Link>{docs && <><span className="brand-divider" aria-hidden="true">/</span><Link href="/docs" className="header-docs-label">Docs</Link></>}</div>
          <nav aria-label="Site" className="site-nav">
            {nav.map(([href,label]) => <Link key={href} href={href} aria-current={href === current ? "page" : undefined}>{label}</Link>)}
            {optz && <Link className="mobile-nav-back" href="/">DIHLabs<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8" /></svg></Link>}
            {!optz && <details className="product-menu"><summary><svg width="20" height="18" viewBox="0 0 72 44" fill="currentColor" aria-hidden="true"><path d="M30 3h35L54 13H19L30 3ZM19 17h31L39 27H8l11-10ZM10 31h24l-10 9H0l10-9ZM54 17h15L43 40H28l26-23Z" /></svg>OPTZ<svg className="menu-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="m4 6 4 4 4-4" /></svg></summary><div className="product-menu-panel"><Link href="/optz"><strong>Explore OPTZ</strong><span>A React framework for Bun</span></Link><Link href="/docs/getting-started"><strong>Documentation</strong><span>Start building with OPTZ</span></Link><Link href="/docs/vs-nextjs"><strong>Benchmarks</strong><span>The measurements and tradeoffs</span></Link></div></details>}
          </nav>
          <div className="header-actions">{docs && <DocsSearch />}<a className="header-github" href={optz ? site.repo : "https://github.com/sxnistxr"} aria-label="GitHub"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.86c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.89 1.52 2.34 1.08 2.91.83.09-.64.35-1.08.64-1.33-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.98 1.03-2.68-.1-.26-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.82c.85 0 1.71.11 2.51.34 1.91-1.29 2.75-1.02 2.75-1.02.55 1.38.2 2.39.1 2.65.64.7 1.03 1.59 1.03 2.68 0 3.85-2.34 4.69-4.57 4.94.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" /></svg></a><ThemeToggle />{optz && <Link className="nav-back" href="/">DIHLabs<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4 12 12 4M4 4h8v8" /></svg></Link>}</div>
        </header>
      </div>
      <main id="main" tabIndex={-1} className={landing ? "landing-main" : cn("site-container", docs ? "docs-main" : "site-main")}>{children}</main>
      <footer className="site-footer site-container">
        <Link href="/" className="footer-brand" aria-label="DihLabs home"><DihLabsLogo /></Link>
        <span>Built with curiosity. By {site.author}.</span>
        <a href={optz ? site.repo : "https://github.com/sxnistxr"}>{optz ? "View framework source" : "Find me on GitHub"}<Arrow /></a>
      </footer>
    </div>
  );
}
