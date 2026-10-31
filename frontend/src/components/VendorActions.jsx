import { useEffect, useRef, useState } from 'react';
import { Dialog } from './ui/Overlays.jsx';
import { vendorsService } from '../services/vendorsService.js';
import { PERMISSIONS } from '../auth/roles.js';

const ACTIONS = Object.freeze({
  REQUEST_WATCHLIST: { label: 'Request watchlist', title: 'Request watchlist', field: 'Reason', confirm: 'Send request',
    description: 'A Supervisor or Admin reviews the request before the vendor is watchlisted.', run: (vendor, text) => vendorsService.requestVendorWatchlist(vendor.id, text) },
  REMOVE_WATCHLIST: { label: 'Remove from watchlist', title: 'Remove from watchlist', field: 'Note', confirm: 'Remove',
    description: 'The vendor returns to normal monitoring. Your note is kept in the monitoring history.', run: (vendor, text) => vendorsService.removeVendorWatchlist(vendor.id, text) },
  REQUEST_BLOCK: { label: 'Request block', title: 'Request block', field: 'Reason', confirm: 'Send request', tone: 'danger',
    description: 'Blocking affects audit monitoring only. It does not stop ERP payments.', run: (vendor, text) => vendorsService.requestVendorBlock(vendor.id, text) },
  UNBLOCK: { label: 'Unblock', title: 'Unblock vendor', field: 'Note', confirm: 'Unblock',
    description: 'The vendor returns to normal monitoring. Your note is kept in the monitoring history.', run: (vendor, text) => vendorsService.unblockVendor(vendor.id, text) },
});

// Governed monitoring actions available to the current role for a vendor.
export function vendorActionKeys(vendor, can) {
  return [
    can(PERMISSIONS.REQUEST_VENDOR_WATCHLIST) && vendor.monitoringStatus === 'NORMAL' && 'REQUEST_WATCHLIST',
    can(PERMISSIONS.REVIEW_VENDOR_WATCHLIST_REQUEST) && vendor.monitoringStatus === 'WATCHLISTED' && 'REMOVE_WATCHLIST',
    can(PERMISSIONS.REQUEST_VENDOR_BLOCK) && vendor.monitoringStatus !== 'BLOCKED' && 'REQUEST_BLOCK',
    can(PERMISSIONS.MANAGE_VENDOR_BLOCK) && vendor.monitoringStatus === 'BLOCKED' && 'UNBLOCK',
  ].filter(Boolean);
}

export const vendorActionLabel = (key) => ACTIONS[key].label;

export function VendorReasonDialog({ request, onClose, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const textRef = useRef(null);
  useEffect(() => { setText(''); setError(null); }, [request?.key, request?.vendor?.id]);
  if (!request) return null;
  const action = ACTIONS[request.key];
  const submit = async (event) => {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true); setError(null);
    try { await action.run(request.vendor, text.trim()); onClose(); await onDone?.(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Vendor request failed.'); }
    finally { setBusy(false); }
  };
  return <Dialog open title={action.title} eyebrow={request.vendor.name ?? request.vendor.id} description={action.description} onClose={onClose} busy={busy} size="sm" initialFocusRef={textRef}>
    <form id="vendor-reason-form" className="dialog-form" onSubmit={submit}>
      <label className="field"><span className="field-label">{action.field}</span>
        <textarea ref={textRef} required rows="4" maxLength={2000} value={text} onChange={(event) => setText(event.target.value)} placeholder="Explain why, for the monitoring history" />
      </label>
      {error && <p className="inline-alert" role="alert">{error}</p>}
      <div className="dialog-inline-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className={`btn ${action.tone === 'danger' ? 'btn-danger' : 'btn-primary'}`} disabled={busy || !text.trim()}>{busy ? 'Saving…' : action.confirm}</button>
      </div>
    </form>
  </Dialog>;
}
