import { redirect, type LoaderContext, type PageProps } from "optz";
import { getAuth } from "$lib/auth.server";
import UploadPanel from "../components/UploadPanel.island";
export const config = { render: "dynamic" } as const;
export const head = () => ({ title: "Private uploads · OPTZ", robots: "noindex" });
export async function loader({ request }: LoaderContext) {
  if (!await getAuth().getSession(request!)) throw redirect("/login");
  return { enabled: !!(process.env.S3_BUCKET && process.env.S3_ENDPOINT) };
}
export default function Files({ data }: PageProps<Awaited<ReturnType<typeof loader>>>) { return <><h1>Private direct uploads</h1><p>File bytes go directly to configured object storage. The server authorizes ownership, reserves quota and approves a separate immutable copy.</p>{data.enabled ? <UploadPanel /> : <p>Configure S3_BUCKET, S3_ENDPOINT, S3_REGION and provider credentials to enable this example.</p>}</>; }
