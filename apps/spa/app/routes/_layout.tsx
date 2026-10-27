import { Link, type Head } from "optz";
import type { ReactNode } from "react";

export const head = (): Head => ({ title: "optz spa", description: "The SPA fixture." });

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <>
      <a href="#main">Skip to content</a>
      <nav>
        <Link href="/">Home</Link> <Link href="/about">About</Link> <Link href="/about" locale="fr">À propos</Link>
      </nav>
      <main id="main">{children}</main>
    </>
  );
}
