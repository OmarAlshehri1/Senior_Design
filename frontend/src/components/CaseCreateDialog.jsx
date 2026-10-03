import { useEffect, useRef, useState } from 'react';
import { CASE_PRIORITIES } from '../cases/caseModel.js';
import useOverlayFocus from '../accessibility/useOverlayFocus.js';

function alertPriority(alert) {
  const candidate = String(alert?.riskLevel ?? alert?.risk ?? '').toUpperCase();
  return Object.values(CASE_PRIORITIES).includes(candidate) ? candidate : 'MEDIUM';
}

export default function CaseCreateDialog({ alert, busy = false, onClose, onSubmit }) {
  const dialogRef = useRef(null); const backdropRef = useRef(null); const cancelRef = useRef(null);
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('MEDIUM'); const [department, setDepartment] = useState('');
  useEffect(() => {
    setTitle(alert?.title ?? ''); setDescription(alert?.reasonText ?? '');
    setPriority(alertPriority(alert)); setDepartment('');
  }, [alert]);
  useOverlayFocus({ active: Boolean(alert), containerRef: dialogRef, initialFocusRef: cancelRef, boundaryRef: backdropRef, onEscape: onClose });
  if (!alert) return null;
  return <div ref={backdropRef} className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}><section ref={dialogRef} tabIndex="-1" className="management-dialog case-create-dialog" role="dialog" aria-modal="true" aria-labelledby="case-create-heading"><header><div><span className="page-eyebrow">Create from Alert {alert.id}</span><h2 id="case-create-heading">Start Investigation Case</h2></div><button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button></header><p>The alert will remain unchanged. Case creation is explicit and will retain its alert and transaction references.</p><form onSubmit={(event) => { event.preventDefault(); onSubmit?.({ title: title.trim(), description: description.trim(), priority, department: department.trim() || null }); }}><label className="dialog-field"><span>Case title</span><input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="dialog-field"><span>Investigation description</span><textarea required rows="4" maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label className="dialog-field"><span>Priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)}>{Object.values(CASE_PRIORITIES).map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="dialog-field"><span>Department (optional)</span><input maxLength={120} value={department} onChange={(event) => setDepartment(event.target.value)} /></label><div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy || !title.trim() || !description.trim()}>{busy ? 'Creating…' : 'Create Case'}</button></div></form></section></div>;
}
