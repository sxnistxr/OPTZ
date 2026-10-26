import type { PageProps } from "optz";

// The full photo page: what a direct visit or a reload shows.
export const paths = () => ["1", "2", "3"].map((id) => ({ id }));

export default function Photo({ params }: PageProps<unknown, "/gallery/photo/[id]">) {
  return <h1 data-testid="photo-page">Photo {params.id} (full page)</h1>;
}
