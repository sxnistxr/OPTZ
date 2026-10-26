import { Link } from "optz";
import type { ReactNode } from "react";

export const head = () => ({ title: "My optz app" });

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl p-6 font-sans">
      <nav className="mb-8 flex gap-4 text-sm">
        <Link href="/">Home</Link>
        <Link href="/about">About</Link>
        <Link href="/users/ada">Ada</Link>
        <Link href="/time">Server time</Link>
      </nav>
      <main>{children}</main>
    </div>
  );
}
