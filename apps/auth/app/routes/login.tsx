import type { PageProps } from "optz";
import AuthPanel from "../components/AuthPanel.island";
import { features } from "$lib/auth.server";
export const config = { render: "dynamic" } as const;
export const head = () => ({ title: "Sign in · OPTZ Auth", robots: "noindex" });
export const loader = () => features();
export default function Login({ data }: PageProps<ReturnType<typeof features>>) {
  return <><h1>Sign in</h1><AuthPanel email={data.email} phone={data.phone} providers={data.providers} /><noscript>The authentication panel uses JavaScript for WebAuthn and interactive verification. The API also supports server-rendered application flows.</noscript></>;
}
