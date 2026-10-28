import type { LoaderContext, PageProps } from "optz";
import { getAuth } from "$lib/auth.server";
import AuthPanel from "../components/AuthPanel.island";
export const config = { render: "dynamic" } as const;
export const head = () => ({ title: "Account · OPTZ Auth", robots: "noindex" });
export async function loader({ request }: LoaderContext) {
  const session = await getAuth().requireSession(request!);
  return { email: session.user.email, mfa: !!(session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled };
}
export default function Account({ data }: PageProps<Awaited<ReturnType<typeof loader>>>) {
  return <><h1>Your account</h1><p>Signed in as {data.email}. Authenticator protection: {data.mfa ? "enabled" : "not enrolled"}.</p><AuthPanel account /></>;
}
