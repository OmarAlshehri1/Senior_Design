import { useRef } from 'react';
import useOverlayFocus from '../accessibility/useOverlayFocus.js';

export default function ConfirmationDialog({ open, title, description, confirmLabel, onConfirm, onClose }) {
  const cancelRef = useRef(null);
  const dialogRef = useRef(null);
  const backdropRef = useRef(null);

  useOverlayFocus({ active: open, containerRef: dialogRef, initialFocusRef: cancelRef, boundaryRef: backdropRef, onEscape: onClose });

  if (!open) return null;

  return (
    <div ref={backdropRef} className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} tabIndex="-1" className="management-dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" aria-describedby="confirmation-description">
        <h2 id="confirmation-title">{title}</h2>
        <p id="confirmation-description">{description}</p>
        <p className="integration-note">This action will become available when account administration is available.</p>
        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled>{confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
