import type { PageProps } from "optz";
import { CloseModal, Modal } from "optz/dialog";

// Intercepts /gallery/photo/[id] when navigating from inside /gallery: the photo shows in the
// @modal slot over the gallery instead of replacing it. <Modal> makes it a real modal dialog
// (focus moves in and stays, Escape closes, focus returns to the photo's link).
export default function PhotoModal({ params }: PageProps<unknown, "/gallery/photo/[id]">) {
  return (
    <Modal label={`Photo ${params.id}`} data-testid="photo-modal" className="fixed inset-10 border bg-white p-6">
      <h2>Photo {params.id} (modal)</h2>
      <CloseModal href="/gallery">Close</CloseModal>
    </Modal>
  );
}
