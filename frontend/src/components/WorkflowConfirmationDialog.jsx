import { useRef } from 'react';
import useOverlayFocus from '../accessibility/useOverlayFocus.js';

export default function WorkflowConfirmationDialog({ open, title, description, confirmLabel, details = [], onClose }) {
  const dialogRef = useRef(null);
  const backdropRef = useRef(null);
  const cancelRef = useRef(null);
  useOverlayFocus({ active: open, containerRef: dialogRef, boundaryRef: backdropRef, initialFocusRef: cancelRef, onEscape: onClose });
  if (!open) return null;
  return <div ref={backdropRef} className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section ref={dialogRef} tabIndex="-1" className="management-dialog workflow-confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="workflow-confirmation-title" aria-describedby="workflow-confirmation-description"><span className="page-eyebrow">Sensitive workflow action</span><h2 id="workflow-confirmation-title">{title}</h2><p id="workflow-confirmation-description">{description}</p>{details.length > 0 && <dl className="workflow-confirmation-details">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}</dl>}<p className="integration-note">Submission remains unavailable until the authoritative workflow service is connected.</p><div className="dialog-actions"><button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="btn btn-primary" disabled>{confirmLabel}</button></div></section></div>;
}
