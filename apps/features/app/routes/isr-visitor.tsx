import type { LoaderContext, PageProps } from "optz";

// ISR that would show a visitor's cookie if regeneration used their request: it mustn't.
export const revalidate = 1;
export const loader = ({ request }: LoaderContext) => ({ cookie: request?.headers.get("cookie") ?? "none" });

export default function IsrVisitor({ data }: PageProps<{ cookie: string }>) {
  return <p data-testid="isr-visitor">cookie: {data.cookie}</p>;
}
