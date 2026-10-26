"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  ["/", "Home"],
  ["/blog", "Writing"],
  ["/social", "Feed"],
] as const;

// The layout is a server component; only the active-link highlight needs the pathname.
export function Nav() {
  const pathname = usePathname();
  const current = (href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));
  return (
    <nav aria-label="Site" className="flex gap-5 text-[0.95rem] md:mt-8 md:flex-col md:gap-1">
      {nav.map(([href, label]) => (
        <Link key={href} href={href} aria-current={current(href) ? "page" : undefined} className={`py-1 ${current(href) ? "font-medium text-ink" : "text-muted hover:text-ink"}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
