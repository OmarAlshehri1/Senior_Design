export const ACCOUNT_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  LOCKED: 'LOCKED',
  DISABLED: 'DISABLED',
});

export const ACCOUNT_STATUS_DEFINITIONS = Object.freeze({
  [ACCOUNT_STATUSES.ACTIVE]: Object.freeze({
    key: ACCOUNT_STATUSES.ACTIVE,
    displayName: 'Active',
    message: null,
  }),
  [ACCOUNT_STATUSES.LOCKED]: Object.freeze({
    key: ACCOUNT_STATUSES.LOCKED,
    displayName: 'Locked',
    message: 'Your account is locked. Contact an administrator for assistance.',
  }),
  [ACCOUNT_STATUSES.DISABLED]: Object.freeze({
    key: ACCOUNT_STATUSES.DISABLED,
    displayName: 'Disabled',
    message: 'This account is currently unavailable. Contact an administrator.',
  }),
});

export function getAccountStatusDefinition(status) {
  return ACCOUNT_STATUS_DEFINITIONS[status] ?? null;
}
