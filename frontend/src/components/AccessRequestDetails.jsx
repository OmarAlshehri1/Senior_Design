import { useEffect, useState } from 'react';
import { ROLE_DEFINITIONS, ROLE_KEYS } from '../auth/roles.js';
import { ACCESS_REQUEST_STATUSES } from '../auth/accessRequest.js';
import ConfirmationDialog from './ConfirmationDialog.jsx';
import { getSensitiveActionConfirmation, SENSITIVE_ACTIONS } from '../security/sensitiveActions.js';

const show = (value) => value ?? '—';

export default function AccessRequestDetails({ request, onClose, onDecision }) {
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [role, setRole] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const approveConfirmation = getSensitiveActionConfirmation(SENSITIVE_ACTIONS.APPROVE_ACCESS_REQUEST);
  const rejectConfirmation = getSensitiveActionConfirmation(SENSITIVE_ACTIONS.REJECT_ACCESS_REQUEST);
  useEffect(() => {
    setApproveOpen(false); setRejectOpen(false); setRole(''); setReason(''); setError('');
  }, [request?.id]);
  if (!request) return null;

  return (
    <aside className="request-detail-panel" aria-labelledby="request-detail-heading">
      <header>
        <div>
          <p className="management-eyebrow">Access Request</p>
          <h2 id="request-detail-heading">{show(request.fullName)}</h2>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
      </header>
      <dl className="management-definition-grid">
        <div><dt>Work Email</dt><dd>{show(request.email)}</dd></div>
        <div><dt>Department</dt><dd>{show(request.department)}</dd></div>
        <div><dt>Employee ID</dt><dd>{show(request.employeeId)}</dd></div>
        <div><dt>Requested At</dt><dd>{show(request.requestedAt)}</dd></div>
        <div><dt>Status</dt><dd>{show(request.status)}</dd></div>
        <div className="definition-wide"><dt>Reason</dt><dd>{show(request.reason)}</dd></div>
      </dl>
      <div className="request-admin-grid">
        <section aria-labelledby="approval-heading">
          <h3 id="approval-heading">Approval</h3>
          <label><span>Assigned Role</span><select disabled={!onDecision || request.status !== ACCESS_REQUEST_STATUSES.PENDING} value={role} onChange={(event) => setRole(event.target.value)}><option value="">Select a role</option>{Object.values(ROLE_KEYS).map((item) => <option value={item} key={item}>{ROLE_DEFINITIONS[item].displayName}</option>)}</select></label>
          <label><span>Optional Team</span><select disabled><option>No teams available</option></select></label>
          <button type="button" className="btn btn-primary" disabled={!onDecision || !role || request.status !== ACCESS_REQUEST_STATUSES.PENDING} onClick={() => setApproveOpen(true)}>{approveConfirmation.confirmLabel}</button>
        </section>
        <section aria-labelledby="rejection-heading">
          <h3 id="rejection-heading">Rejection</h3>
          <label><span>Reason (optional)</span><textarea disabled={!onDecision || request.status !== ACCESS_REQUEST_STATUSES.PENDING} rows="3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Add a reason for the decision" /></label>
          <button type="button" className="btn btn-secondary" disabled={!onDecision || request.status !== ACCESS_REQUEST_STATUSES.PENDING} onClick={() => setRejectOpen(true)}>Reject Request</button>
        </section>
      </div>
      {error && <p role="alert">{error}</p>}
      <ConfirmationDialog open={approveOpen} {...approveConfirmation} available={Boolean(onDecision)} busy={busy} note="The requester will receive access after the decision is saved." onConfirm={async () => {
        setBusy(true); setError('');
        try { await onDecision({ approve: true, role, reason: reason || null }); setApproveOpen(false); }
        catch (decisionError) { setError(decisionError instanceof Error ? decisionError.message : 'The request could not be approved.'); }
        finally { setBusy(false); }
      }} onClose={() => setApproveOpen(false)} />
      <ConfirmationDialog open={rejectOpen} {...rejectConfirmation} available={Boolean(onDecision)} busy={busy} note="The decision and optional reason will be retained." onConfirm={async () => {
        setBusy(true); setError('');
        try { await onDecision({ approve: false, reason: reason || null }); setRejectOpen(false); }
        catch (decisionError) { setError(decisionError instanceof Error ? decisionError.message : 'The request could not be rejected.'); }
        finally { setBusy(false); }
      }} onClose={() => setRejectOpen(false)} />
    </aside>
  );
}
