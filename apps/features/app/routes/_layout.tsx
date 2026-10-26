import { Link, useLocale, type Head } from "optz";
import type { ReactNode } from "react";

export const head = (): Head => ({ title: "optz features", description: "Every feature optz shares with Next.js." });

const nav = [
  ["/", "Home"],
  ["/stream", "Streaming"],
  ["/notes", "Actions"],
  ["/isr", "ISR"],
  ["/gallery", "Gallery"],
  ["/dashboard", "Dashboard"],
  ["/docs", "Docs"],
  ["/media", "Media"],
] as const;

export default function Layout({ children }: { children: ReactNode }) {
  const locale = useLocale();
  return (
    <div className="mx-auto max-w-3xl p-6 font-sans">
      <nav className="mb-8 flex flex-wrap gap-4 text-sm">
        {nav.map(([href, label]) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
        <span className="ml-auto">
          <Link href="/" locale="en" data-testid="to-en">
            English
          </Link>{" "}
          ·{" "}
          <Link href="/" locale="fr" data-testid="to-fr">
            Français
          </Link>
        </span>
      </nav>
      <p className="mb-4 text-xs text-gray-500" data-testid="locale">
        locale: {locale}
      </p>
      <main>{children}</main>
    </div>
  );
}
