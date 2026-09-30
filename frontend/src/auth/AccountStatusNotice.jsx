import { ACCOUNT_STATUSES, getAccountStatusDefinition } from './accountStatus';

export default function AccountStatusNotice({ status }) {
  const definition = getAccountStatusDefinition(status);
  if (!definition || status === ACCOUNT_STATUSES.ACTIVE || !definition.message) return null;

  return (
    <div className={`auth-status-notice status-${status.toLowerCase()}`} role="alert">
      <strong>{definition.displayName}</strong>
      <span>{definition.message}</span>
    </div>
  );
}
