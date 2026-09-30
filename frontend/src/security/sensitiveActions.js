export const SENSITIVE_ACTIONS = Object.freeze({
  APPROVE_ACCESS_REQUEST: 'APPROVE_ACCESS_REQUEST',
  REJECT_ACCESS_REQUEST: 'REJECT_ACCESS_REQUEST',
  CHANGE_ROLE: 'CHANGE_ROLE',
  UNLOCK_ACCOUNT: 'UNLOCK_ACCOUNT',
  DISABLE_ACCOUNT: 'DISABLE_ACCOUNT',
  ENABLE_ACCOUNT: 'ENABLE_ACCOUNT',
  ASSIGN_ALERT: 'ASSIGN_ALERT',
  REASSIGN_ALERT: 'REASSIGN_ALERT',
});

export const SENSITIVE_ACTION_CONFIRMATIONS = Object.freeze({
  [SENSITIVE_ACTIONS.APPROVE_ACCESS_REQUEST]: Object.freeze({ title: 'Approve Access Request?', description: 'The selected role will determine this user’s system access.', confirmLabel: 'Approve & Activate' }),
  [SENSITIVE_ACTIONS.REJECT_ACCESS_REQUEST]: Object.freeze({ title: 'Reject Access Request?', description: 'The request will remain available as a historical access decision.', confirmLabel: 'Reject Request' }),
  [SENSITIVE_ACTIONS.CHANGE_ROLE]: Object.freeze({ title: 'Change Role?', description: 'The selected role changes this user’s authorization scope.', confirmLabel: 'Change Role' }),
  [SENSITIVE_ACTIONS.UNLOCK_ACCOUNT]: Object.freeze({ title: 'Unlock Account?', description: 'Restoring access will allow this user to sign in again.', confirmLabel: 'Unlock Account' }),
  [SENSITIVE_ACTIONS.DISABLE_ACCOUNT]: Object.freeze({ title: 'Disable Account?', description: 'This user will no longer be able to sign in.', confirmLabel: 'Disable Account' }),
  [SENSITIVE_ACTIONS.ENABLE_ACCOUNT]: Object.freeze({ title: 'Enable Account?', description: 'Restoring access will allow this user to sign in again.', confirmLabel: 'Enable Account' }),
  [SENSITIVE_ACTIONS.ASSIGN_ALERT]: Object.freeze({ title: 'Assign Alert?', description: 'The selected user will receive responsibility for this alert.', confirmLabel: 'Assign Alert' }),
  [SENSITIVE_ACTIONS.REASSIGN_ALERT]: Object.freeze({ title: 'Reassign Alert?', description: 'The existing assignment remains part of the assignment history.', confirmLabel: 'Reassign Alert' }),
});

export function getSensitiveActionConfirmation(action) {
  return SENSITIVE_ACTION_CONFIRMATIONS[action] ?? null;
}

