import DateTime from './DateTime.jsx';
import { useEffect, useState } from 'react';
import { ROLE_DEFINITIONS, ROLE_KEYS } from '../auth/roles.js';
import { ACCESS_REQUEST_STATUSES } from '../auth/accessRequest.js';
import ConfirmationDialog from './ConfirmationDialog.jsx';
import { getSensitiveActionConfirmation, SENSITIVE_ACTIONS } from '../security/sensitiveActions.js';
import { Dialog } from './ui/Overlays.jsx';

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
    <Dialog open variant="drawer" eyebrow="Access request" title={show(request.fullName)} description={show(request.email)} onClose={onClose} suppressEscape={approveOpen || rejectOpen}>
      <dl className="key-values columns-2">
        <div><dt>Department</dt><dd>{show(request.department)}</dd></div>
        <div><dt>Employee ID</dt><dd>{show(request.employeeId)}</dd></div>
        <div><dt>Requested</dt><dd><DateTime value={request.requestedAt} /></dd></div>
        <div><dt>Status</dt><dd>{show(request.status)}</dd></div>
        <div className="definition-wide"><dt>Reason</dt><dd>{show(request.reason)}</dd></div>
      </dl>
      {request.status === ACCESS_REQUEST_STATUSES.PENDING ? <div className="request-decision">
        <section className="request-decision-block" aria-labelledby="approval-heading">
          <h3 id="approval-heading">Approve</h3>
          <label className="field"><span className="field-label">Role to grant</span><select disabled={!onDecision} value={role} onChange={(event) => setRole(event.target.value)}><option value="">Select a role</option>{Object.values(ROLE_KEYS).map((item) => <option value={item} key={item}>{ROLE_DEFINITIONS[item].displayName}</option>)}</select></label>
          <button type="button" className="btn btn-primary" disabled={!onDecision || !role} onClick={() => setApproveOpen(true)}>{approveConfirmation.confirmLabel}</button>
        </section>
        <section className="request-decision-block" aria-labelledby="rejection-heading">
          <h3 id="rejection-heading">Reject</h3>
          <label className="field"><span className="field-label">Reason (optional)</span><textarea disabled={!onDecision} rows="3" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Shared with the decision record" /></label>
          <button type="button" className="btn btn-danger" disabled={!onDecision} onClick={() => setRejectOpen(true)}>Reject Request</button>
        </section>
      </div> : <p className="inline-note">This request has already been decided.</p>}
      {error && <p role="alert" className="inline-alert">{error}</p>}
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
    </Dialog>
  );
}
