import type { LoaderContext, PageProps } from "optz";

// Optional catch-all: /docs, /docs/a, /docs/a/b all render here.
export const paths = () => [{}, { slug: "intro" }, { slug: "guide/setup" }];
export const loader = ({ params }: LoaderContext<{ slug?: string }>) => ({ slug: params.slug ?? "" });

export default function Docs({ data }: PageProps<{ slug: string }, "/docs/[[...slug]]">) {
  return <h1 data-testid="docs">docs: {data.slug || "(index)"}</h1>;
}
