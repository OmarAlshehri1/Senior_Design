import { useRef, useState } from 'react';
import { ACCOUNT_STATUSES } from '../auth/accountStatus.js';
import { ROLE_DEFINITIONS, ROLE_KEYS } from '../auth/roles.js';
import ConfirmationDialog from './ConfirmationDialog.jsx';
import { getSensitiveActionConfirmation, SENSITIVE_ACTIONS } from '../security/sensitiveActions.js';
import useOverlayFocus from '../accessibility/useOverlayFocus.js';

const ACTION_TYPES = Object.freeze({
  disable: SENSITIVE_ACTIONS.DISABLE_ACCOUNT,
  enable: SENSITIVE_ACTIONS.ENABLE_ACCOUNT,
});

export default function UserAdministrativeActions({ user = null, onAction, onRoleChange }) {
  const [action, setAction] = useState(null);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const roleSelectRef = useRef(null);
  const roleDialogRef = useRef(null);
  const roleBackdropRef = useRef(null);
  const [selectedRole, setSelectedRole] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unavailable = !user;
  const confirmation = getSensitiveActionConfirmation(ACTION_TYPES[action]);
  const roleConfirmation = getSensitiveActionConfirmation(SENSITIVE_ACTIONS.CHANGE_ROLE);

  useOverlayFocus({
    active: roleDialogOpen,
    containerRef: roleDialogRef,
    initialFocusRef: roleSelectRef,
    boundaryRef: roleBackdropRef,
    onEscape: () => setRoleDialogOpen(false),
  });

  return (
    <>
      <section className="management-detail-card user-admin-actions">
        <h2>Administrative Actions</h2>
        <p>{unavailable ? 'Actions require an available user record and available account administration.' : 'Sensitive account changes require explicit confirmation.'}</p>
        <div>
          <button type="button" className="btn btn-secondary" disabled={unavailable || !onRoleChange} onClick={() => setRoleDialogOpen(true)}>Change Role</button>
          <button type="button" className="btn btn-secondary" disabled={unavailable || !onAction || user?.accountStatus === ACCOUNT_STATUSES.DISABLED} onClick={() => setAction('disable')}>Disable Account</button>
          <button type="button" className="btn btn-secondary" disabled={unavailable || !onAction || user?.accountStatus !== ACCOUNT_STATUSES.DISABLED} onClick={() => setAction('enable')}>Enable Account</button>
        </div>
        {error && <p role="alert">{error}</p>}
      </section>
      {roleDialogOpen && (
        <div ref={roleBackdropRef} className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setRoleDialogOpen(false)}>
          <section ref={roleDialogRef} tabIndex="-1" className="management-dialog" role="dialog" aria-modal="true" aria-labelledby="change-role-heading">
            <h2 id="change-role-heading">{roleConfirmation.title}</h2>
            <p>{roleConfirmation.description}</p>
            <label className="dialog-field"><span>New Role</span><select ref={roleSelectRef} value={selectedRole} onChange={(event) => setSelectedRole(event.target.value)}><option value="">Select a role</option>{Object.values(ROLE_KEYS).map((role) => <option key={role} value={role}>{ROLE_DEFINITIONS[role].displayName}</option>)}</select></label>
            {!onRoleChange && <p className="integration-note">Role changes will become available when account administration is available.</p>}
            <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={() => setRoleDialogOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled={!selectedRole || !onRoleChange || busy} onClick={async () => { setBusy(true); setError(''); try { await onRoleChange(selectedRole); setRoleDialogOpen(false); setSelectedRole(''); } catch (actionError) { setError(actionError instanceof Error ? actionError.message : 'The role could not be changed.'); } finally { setBusy(false); } }}>{busy ? 'Working…' : roleConfirmation.confirmLabel}</button></div>
          </section>
        </div>
      )}
      <ConfirmationDialog open={Boolean(action)} {...confirmation} available={Boolean(onAction)} busy={busy} note={onAction ? 'The account change will be recorded and existing sessions will be revoked.' : undefined} onConfirm={async () => { setBusy(true); setError(''); try { await onAction(action); setAction(null); } catch (actionError) { setError(actionError instanceof Error ? actionError.message : 'The account change could not be saved.'); } finally { setBusy(false); } }} onClose={() => setAction(null)} />
    </>
  );
}
