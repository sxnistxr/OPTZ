import { Link } from "optz";
import type { ReactNode } from "react";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <header className="mb-10 flex items-baseline justify-between">
        <Link href="/" className="font-semibold tracking-tight">
          social demo
        </Link>
        <a href="https://dihlabs.lol/docs/engine" className="text-sm text-muted hover:text-ink">
          How the engine works
        </a>
      </header>
      <main>{children}</main>
    </div>
  );
}
