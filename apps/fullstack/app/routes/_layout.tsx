import type { ReactNode } from "react";
import { Link } from "optz";
export default function Layout({ children }: { children: ReactNode }) {
  return <><header><Link href="/">OPTZ app</Link> · <Link href="/dashboard">Dashboard</Link></header><main>{children}</main><footer>HTML first. JavaScript only where you need it.</footer></>;
}
