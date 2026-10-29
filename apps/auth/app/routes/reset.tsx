import type { LoaderContext, PageProps } from "optz";
import ResetForm from "../components/ResetForm.island";
export const config = { render: "dynamic" } as const;
export const head = () => ({ title: "Reset password", robots: "noindex" });
export const loader = ({ url }: LoaderContext) => ({ token: url.searchParams.get("token") ?? "" });
export default function Reset({ data }: PageProps<{ token: string }>) { return <><h1>Reset password</h1><ResetForm token={data.token} /></>; }
