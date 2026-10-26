import type { LoaderContext, PageProps } from "optz";

// A static page with a parameter: paths() lists the pages to build.
export const paths = () => [{ name: "ada" }, { name: "grace" }];
export const loader = ({ params }: LoaderContext) => ({ name: params.name });
export const head = (d: { name: string }) => ({ title: `User ${d.name}` });

export default function User({ data }: PageProps<{ name: string }>) {
  return <h1 className="text-3xl font-semibold">User {data.name}</h1>;
}
