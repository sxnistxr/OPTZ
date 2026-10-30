import type { ReactNode } from "react";
import { Link } from "optz";
export default function Layout({ children }: { children: ReactNode }) {
  return <><header><Link href="/">OPTZ Auth</Link><nav><Link href="/login">Sign in</Link> · <Link href="/account">Account</Link> · <Link href="/status">Status</Link> · <Link href="/modules">Modules</Link> · <Link href="/files">Files</Link> · <Link href="/metrics-demo">Analytics demo</Link></nav></header><main>{children}</main><footer>Authentication loads where the app needs it.</footer></>;
}
