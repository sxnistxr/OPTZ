import type { ReactNode } from "react";

// `modal` is the @modal slot: empty normally, the photo when navigated to from the gallery.
export default function GalleryLayout({ children, modal }: { children: ReactNode; modal?: ReactNode }) {
  return (
    <section>
      {children}
      {modal}
    </section>
  );
}
