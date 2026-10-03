import { useEffect, useRef, useState } from 'react';
import AssignmentHistory from './AssignmentHistory.jsx';
import { getSensitiveActionConfirmation, SENSITIVE_ACTIONS } from '../security/sensitiveActions.js';
import useOverlayFocus from '../accessibility/useOverlayFocus.js';

export default function AssignmentDialog({ alert, currentAssignment = null, eligibleUsers = [], history = [], busy = false, error = null, onSave, onUnassign, onClose }) {
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  const backdropRef = useRef(null);
  const [assigneeId, setAssigneeId] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => { setAssigneeId(''); setNote(''); }, [alert?.id]);
  useOverlayFocus({ active: Boolean(alert), containerRef: dialogRef, initialFocusRef: closeRef, boundaryRef: backdropRef, onEscape: onClose });

  if (!alert) return null;
  const isReassignment = Boolean(currentAssignment?.assigneeId ?? currentAssignment?.assignee_id);
  const confirmation = getSensitiveActionConfirmation(isReassignment ? SENSITIVE_ACTIONS.REASSIGN_ALERT : SENSITIVE_ACTIONS.ASSIGN_ALERT);

  return (
    <div ref={backdropRef} className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} tabIndex="-1" className="management-dialog assignment-dialog" role="dialog" aria-modal="true" aria-labelledby="assignment-dialog-title">
        <header><div><p className="management-eyebrow">Alert {alert.id}</p><h2 id="assignment-dialog-title">{isReassignment ? 'Reassign Alert' : 'Assign Alert'}</h2></div>
          <button ref={closeRef} type="button" className="btn btn-secondary" onClick={onClose}>Close</button></header>
        <dl className="assignment-current"><div><dt>Current Assignment</dt><dd>{currentAssignment?.assigneeName ?? currentAssignment?.assignee_name ?? '—'}</dd></div></dl>
        <label className="dialog-field"><span>Assign To</span>
          <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} disabled={busy || eligibleUsers.length === 0}>
            <option value="">{eligibleUsers.length ? 'Select an eligible user' : 'No eligible users are available'}</option>
            {eligibleUsers.map((user) => <option value={user.id} key={user.id}>{user.name} ({user.role})</option>)}
          </select>
        </label>
        <label className="dialog-field"><span>Note (optional)</span><textarea rows="3" value={note} maxLength={2000} disabled={busy} onChange={(event) => setNote(event.target.value)} placeholder="Assignment notes are retained with history" /></label>
        {error && <p role="alert" className="integration-note">{error}</p>}
        {eligibleUsers.length === 0 && <p className="integration-note">No eligible users are available.</p>}
        <section className="assignment-history-section" aria-labelledby="assignment-history-heading"><h3 id="assignment-history-heading">Assignment History</h3><AssignmentHistory records={history} /></section>
        <div className="dialog-actions">
          {isReassignment && <button type="button" className="btn btn-secondary" disabled={busy} onClick={onUnassign}>Unassign</button>}
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={busy || !assigneeId} onClick={() => onSave?.({ assigneeId, note })}>{busy ? 'Saving…' : confirmation.confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
