import type { LoaderContext, PageProps } from "optz";

// Dynamic: rendered on every request; the loader sees the request and middleware locals.
export const config = { render: "dynamic" } as const;
export const loader = ({ request, locals }: LoaderContext) => ({
  now: new Date().toISOString(),
  requestId: String(locals.requestId),
  agent: request?.headers.get("user-agent") ?? "",
});

export default function Time({ data }: PageProps<{ now: string; requestId: string; agent: string }>) {
  return (
    <>
      <h1 className="text-3xl font-semibold">Server time</h1>
      <p className="mt-2">{data.now}</p>
      <p className="mt-2 text-sm text-gray-500">Request {data.requestId}</p>
    </>
  );
}
