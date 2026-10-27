// <Modal>: an accessible modal for intercepted routes and other overlays, without an island.
// It renders a <dialog> that the browser runtime opens with showModal(): focus moves into it
// and stays there, the page behind is inert, it has role "dialog" and aria-modal, Escape closes
// it, and focus returns to the link that opened it. Without JavaScript it's an open <dialog>
// whose close link works as a plain link.
//
//   import { Modal, CloseModal } from "optz/dialog";
//   <Modal label="Photo 3" closeHref="/gallery">
//     <h2>Photo 3</h2>
//     <CloseModal>Close</CloseModal>
//   </Modal>
import type { DialogHTMLAttributes, ReactNode } from "react";

export interface ModalProps extends Omit<DialogHTMLAttributes<HTMLDialogElement>, "open"> {
  /** The accessible name (or use aria-labelledby with a heading's id). */
  label?: string;
  /** Where closing goes. Default: back in history (where the modal was opened from). */
  closeHref?: string;
  children: ReactNode;
}

export function Modal({ label, closeHref, children, ...rest }: ModalProps) {
  if (!label && !rest["aria-labelledby"]) throw new Error("<Modal>: give it a label (or aria-labelledby)");
  return (
    <dialog {...rest} open data-optz-modal="" aria-label={label} data-close-href={closeHref}>
      {children}
    </dialog>
  );
}

/** Closes the enclosing <Modal>: a link to `href` (works without JavaScript), else a button. */
export function CloseModal({ href, children, className }: { href?: string; children: ReactNode; className?: string }) {
  return href ? (
    <a href={href} data-optz-close="" className={className}>
      {children}
    </a>
  ) : (
    <button type="button" data-optz-close="" className={className}>
      {children}
    </button>
  );
}

export default Modal;
