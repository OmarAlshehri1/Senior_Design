import { useEffect, useRef } from 'react';
import AssignmentHistory from './AssignmentHistory.jsx';
import { getSensitiveActionConfirmation, SENSITIVE_ACTIONS } from '../security/sensitiveActions.js';

export default function AssignmentDialog({ alert, currentAssignment = null, eligibleUsers = [], history = [], onClose }) {
  const closeRef = useRef(null);

  useEffect(() => {
    if (!alert) return undefined;
    closeRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [alert, onClose]);

  if (!alert) return null;
  const isReassignment = Boolean(currentAssignment);
  const confirmation = getSensitiveActionConfirmation(isReassignment ? SENSITIVE_ACTIONS.REASSIGN_ALERT : SENSITIVE_ACTIONS.ASSIGN_ALERT);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="management-dialog assignment-dialog" role="dialog" aria-modal="true" aria-labelledby="assignment-dialog-title">
        <header>
          <div>
            <p className="management-eyebrow">Alert {alert.id}</p>
            <h2 id="assignment-dialog-title">{isReassignment ? 'Reassign Alert' : 'Assign Alert'}</h2>
          </div>
          <button ref={closeRef} type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        </header>
        <dl className="assignment-current">
          <div><dt>Current Assignment</dt><dd>{currentAssignment?.assigneeName ?? '—'}</dd></div>
        </dl>
        <label className="dialog-field">
          <span>Assign To</span>
          <select disabled={eligibleUsers.length === 0} defaultValue="">
            <option value="">{eligibleUsers.length ? 'Select an eligible user' : 'No eligible users are available'}</option>
            {eligibleUsers.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}
          </select>
        </label>
        <label className="dialog-field">
          <span>Note (optional)</span>
          <textarea rows="3" disabled placeholder="Assignment notes will be retained with history" />
        </label>
        {eligibleUsers.length === 0 && <p className="integration-note">No eligible users are available.</p>}
        <section className="assignment-history-section" aria-labelledby="assignment-history-heading">
          <h3 id="assignment-history-heading">Assignment History</h3>
          <AssignmentHistory records={history} />
        </section>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled>{confirmation.confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
