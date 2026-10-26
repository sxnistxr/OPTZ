import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Nav } from "$components/Nav";
import site from "$lib/site";
import "./globals.css";

export const metadata: Metadata = { title: site.title, description: site.about, icons: { icon: { url: "/favicon.svg", type: "image/svg+xml" } } };

const fonts =
  "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=Schibsted+Grotesk:wght@400;500;600;700&display=swap";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={fonts} />
      </head>
      <body>
        <a href="#main" className="sr-only bg-paper px-3 py-2 focus:not-sr-only focus:absolute focus:left-4 focus:top-4">
          Skip to content
        </a>
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8 md:grid md:grid-cols-[9rem_minmax(0,1fr)] md:gap-14 md:py-16">
          <header className="mb-10 flex items-baseline justify-between gap-6 md:mb-0 md:block">
            <Link href="/" className="font-semibold tracking-tight text-ink">
              {site.name}
            </Link>
            <Nav />
          </header>
          <main id="main" className="min-w-0">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
