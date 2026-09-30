import { useEffect, useRef, useState } from 'react';
import { ACCOUNT_STATUSES } from '../auth/accountStatus.js';
import { ROLE_DEFINITIONS, ROLE_KEYS } from '../auth/roles.js';
import ConfirmationDialog from './ConfirmationDialog.jsx';
import { getSensitiveActionConfirmation, SENSITIVE_ACTIONS } from '../security/sensitiveActions.js';

const ACTION_TYPES = Object.freeze({
  unlock: SENSITIVE_ACTIONS.UNLOCK_ACCOUNT,
  disable: SENSITIVE_ACTIONS.DISABLE_ACCOUNT,
  enable: SENSITIVE_ACTIONS.ENABLE_ACCOUNT,
});

export default function UserAdministrativeActions({ user = null }) {
  const [action, setAction] = useState(null);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const roleSelectRef = useRef(null);
  const unavailable = !user;
  const confirmation = getSensitiveActionConfirmation(ACTION_TYPES[action]);
  const roleConfirmation = getSensitiveActionConfirmation(SENSITIVE_ACTIONS.CHANGE_ROLE);

  useEffect(() => {
    if (!roleDialogOpen) return undefined;
    roleSelectRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setRoleDialogOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [roleDialogOpen]);

  return (
    <>
      <section className="management-detail-card user-admin-actions">
        <h2>Administrative Actions</h2>
        <p>{unavailable ? 'Actions require an available user record and available account administration.' : 'Sensitive account changes require explicit confirmation.'}</p>
        <div>
          <button type="button" className="btn btn-secondary" disabled={unavailable} onClick={() => setRoleDialogOpen(true)}>Change Role</button>
          <button type="button" className="btn btn-secondary" disabled={unavailable || user?.accountStatus !== ACCOUNT_STATUSES.LOCKED} onClick={() => setAction('unlock')}>Unlock Account</button>
          <button type="button" className="btn btn-secondary" disabled={unavailable || user?.accountStatus === ACCOUNT_STATUSES.DISABLED} onClick={() => setAction('disable')}>Disable Account</button>
          <button type="button" className="btn btn-secondary" disabled={unavailable || user?.accountStatus !== ACCOUNT_STATUSES.DISABLED} onClick={() => setAction('enable')}>Enable Account</button>
        </div>
      </section>
      {roleDialogOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setRoleDialogOpen(false)}>
          <section className="management-dialog" role="dialog" aria-modal="true" aria-labelledby="change-role-heading">
            <h2 id="change-role-heading">{roleConfirmation.title}</h2>
            <p>{roleConfirmation.description}</p>
            <label className="dialog-field"><span>New Role</span><select ref={roleSelectRef} defaultValue=""><option value="">Select a role</option>{Object.values(ROLE_KEYS).map((role) => <option key={role} value={role}>{ROLE_DEFINITIONS[role].displayName}</option>)}</select></label>
            <p className="integration-note">Role changes will become available when account administration is available.</p>
            <div className="dialog-actions"><button type="button" className="btn btn-secondary" onClick={() => setRoleDialogOpen(false)}>Cancel</button><button type="button" className="btn btn-primary" disabled>{roleConfirmation.confirmLabel}</button></div>
          </section>
        </div>
      )}
      <ConfirmationDialog open={Boolean(action)} {...confirmation} onConfirm={() => {}} onClose={() => setAction(null)} />
    </>
  );
}
