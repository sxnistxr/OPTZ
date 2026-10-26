import { Link, type PageProps } from "optz";

// Intercepts /gallery/photo/[id] when navigating from inside /gallery: the photo shows in the
// @modal slot over the gallery instead of replacing it.
export default function PhotoModal({ params }: PageProps<unknown, "/gallery/photo/[id]">) {
  return (
    <div role="dialog" data-testid="photo-modal" className="fixed inset-10 border bg-white p-6">
      Photo {params.id} (modal)
      <Link href="/gallery">Close</Link>
    </div>
  );
}
