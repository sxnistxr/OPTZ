import type { LoaderContext, PageProps } from "optz";

// Static, but rendered per request while draft mode is on (GET /api/draft?secret=...).
export const loader = ({ draft }: LoaderContext) => ({ draft: !!draft, at: Date.now() });

export default function Draft({ data }: PageProps<{ draft: boolean; at: number }>) {
  return (
    <>
      <h1>Draft mode</h1>
      <p data-testid="draft">{data.draft ? `draft view ${data.at}` : "published view"}</p>
    </>
  );
}
