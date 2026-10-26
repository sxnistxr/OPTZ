import { Link, useRouter, type Head, type Href } from "optz";
import type { ReactNode } from "react";
import site from "$lib/site";

const nav: [Href, string][] = [
  ["/", "Home"],
  ["/lab", "Lab"],
  ["/blog", "Writing"],
  ["/docs", "Docs"],
];

export const head = (): Head => ({ title: site.title, description: site.about, openGraph: { siteName: site.title } });

export default function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useRouter();
  const current = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  // Docs pages have their own sidebar, so they get a wider page.
  const wide = pathname === "/docs" || pathname.startsWith("/docs/");
  return (
    <>
      <a href="#main" className="sr-only bg-paper px-3 py-2 focus:not-sr-only focus:absolute focus:left-4 focus:top-4">
        Skip to content
      </a>
      {/* A thin bar while the next page loads (the framework sets html.optz-navigating). */}
      <div aria-hidden className="fixed inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-signal transition-transform duration-300 [.optz-navigating_&]:scale-x-75" />
      <div className={`mx-auto px-4 py-8 sm:px-8 md:grid md:grid-cols-[9rem_minmax(0,1fr)] md:gap-14 md:py-16 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>
        <header className="mb-10 flex items-baseline justify-between gap-6 md:mb-0 md:block">
          <Link href="/" className="block leading-tight">
            <span className="font-semibold tracking-tight text-ink">{site.name}</span>
            <span className="mt-0.5 hidden text-xs text-muted md:block">by {site.author}</span>
          </Link>
          <nav aria-label="Site" className="flex gap-5 text-[0.95rem] md:mt-8 md:flex-col md:gap-1">
            {nav.map(([href, label]) => (
              <Link key={href} href={href} aria-current={current(href) ? "page" : undefined} className={`py-1 ${current(href) ? "font-medium text-ink" : "text-muted hover:text-ink"}`}>
                {label}
              </Link>
            ))}
          </nav>
        </header>
        <main id="main" className="min-w-0">
          {children}
        </main>
      </div>
    </>
  );
}
