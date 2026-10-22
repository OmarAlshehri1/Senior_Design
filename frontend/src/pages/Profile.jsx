import DateTime from '../components/DateTime.jsx';
import { useEffect, useState } from 'react';
import useAuthorization from '../auth/useAuthorization.js';
import { AUTHORIZATION_MODES } from '../auth/AuthorizationProvider.jsx';
import { createProfileModel } from '../auth/profileModel.js';
import LoginHistory from '../components/LoginHistory.jsx';
import { createSecurityActivity } from '../audit/loginHistory.js';
import { userManagementService } from '../management/userManagementService.js';

const displayValue = (value, unavailableLabel) => value ?? unavailableLabel;

function ProfileField({ label, value, unavailableLabel = 'Not available' }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={value === null ? 'profile-value-unavailable' : ''}>{displayValue(value, unavailableLabel)}</dd>
    </div>
  );
}

export default function Profile() {
  const { mode, effectiveRole, user } = useAuthorization();
  const [history, setHistory] = useState({ userId: null, status: 'loading', items: [], error: '', refreshing: false });
  const [historyReload, setHistoryReload] = useState(0);
  const previewRole = mode === AUTHORIZATION_MODES.ROLE_PREVIEW ? effectiveRole : null;
  const profile = createProfileModel(user, previewRole);
  const securityActivity = createSecurityActivity();

  useEffect(() => {
    if (!user?.id) return undefined;
    const controller = new AbortController();
    setHistory((previous) => ({ userId: user.id, status: 'loading', items: [], error: '',
      refreshing: previous.userId === user.id && previous.status === 'success' }));
    userManagementService.listLoginHistory(user.id, { query: { page: 1, page_size: 20 }, signal: controller.signal })
      .then((page) => { if (!Array.isArray(page?.items)) throw new Error('Sign-in history returned an invalid response.'); if (!controller.signal.aborted) setHistory({ userId: user.id, status: 'success', error: '', refreshing: false,
        items: (page?.items ?? []).map((item) => ({ id: item.id, outcome: item.outcome, timestamp: item.created_at })) }); })
      .catch((error) => { if (!controller.signal.aborted) setHistory({ userId: user.id,
        status: error?.code === 'CONFIGURATION_UNAVAILABLE' ? 'unavailable' : 'error', items: [], error: error?.message || 'Sign-in history could not be loaded.', refreshing: false }); });
    return () => controller.abort();
  }, [user?.id, historyReload]);
  const currentHistory = !user?.id ? { status: 'unavailable', items: [], error: 'Sign-in history requires an authenticated account.' }
    : history.userId !== user.id ? { status: 'loading', items: [] } : history;

  return (
    <div className="profile-page">
      <div className="page-header profile-page-header">
        <div>
          <h1>My Profile</h1>
          <p>Account information, activity, and security context.</p>
        </div>
        {profile.previewRole && (
          <span className={`role-badge role-${profile.previewRole.key.toLowerCase()}`}>
            Role Preview: {profile.previewRole.displayName}
          </span>
        )}
      </div>

      <section className="profile-identity" aria-labelledby="profile-identity-heading">
        <div className="profile-identity-mark" aria-hidden="true">—</div>
        <div>
          <p className="profile-eyebrow">{profile.hasIdentity ? 'Authenticated account' : 'Development preview'}</p>
          <h2 id="profile-identity-heading">{profile.hasIdentity ? profile.fields.name : 'Profile information unavailable'}</h2>
          <p>{profile.hasIdentity ? profile.fields.email : 'Profile information will appear when an authenticated account is connected.'}</p>
        </div>
      </section>

      <div className="profile-grid">
        <section className="profile-section profile-section-wide" aria-labelledby="account-information-heading">
          <header>
            <h2 id="account-information-heading">Account Information</h2>
            <p>Identity and account details supplied by the authenticated account service.</p>
          </header>
          <dl className="profile-definition-grid">
            <ProfileField label="Name" value={profile.fields.name} />
            <ProfileField label="Email" value={profile.fields.email} />
            <ProfileField label="Role" value={profile.fields.role} />
            <ProfileField label="Account Status" value={profile.fields.accountStatus} />
            <ProfileField label="Last Login" value={<DateTime value={profile.fields.lastLoginAt} />} />
          </dl>
        </section>

        <section className="profile-section" aria-labelledby="my-activity-heading">
          <header>
            <h2 id="my-activity-heading">My Activity</h2>
          </header>
          <dl className="profile-definition-list">
            <ProfileField label="Reviews Completed" value={profile.fields.reviewsCompleted} />
            <ProfileField label="Alerts Assigned" value={profile.fields.alertsAssigned} />
            <ProfileField label="Last Review" value={<DateTime value={profile.fields.lastReviewAt} />} />
          </dl>
        </section>

        <section className="profile-section" aria-labelledby="security-access-heading">
          <header>
            <h2 id="security-access-heading">Sign-In &amp; Security Activity</h2>
          </header>
          <dl className="profile-definition-list">
            <ProfileField label="Last Login" value={<DateTime value={user?.lastLoginAt ?? securityActivity.lastLoginAt} />} unavailableLabel="—" />
            <ProfileField label="Failed Sign-In Attempts" value={user?.failedSignInAttempts ?? securityActivity.failedSignInAttempts} unavailableLabel="—" />
            <ProfileField label="Account Status" value={user?.accountStatus ?? securityActivity.accountStatus} unavailableLabel="—" />
          </dl>
          <div className="profile-login-history">
            <h3>Recent Sign-In Activity</h3>
            <ProfileHistory history={currentHistory} onRefresh={user?.id ? () => setHistoryReload((value) => value + 1) : null} />
          </div>
        </section>
      </div>
    </div>
  );
}

export function ProfileHistory({ history, onRefresh }) {
  return <div aria-busy={history.status === 'loading'}>
    {history.status === 'loading' ? <p role="status">{history.refreshing ? 'Refreshing sign-in history…' : 'Loading sign-in history…'}</p>
      : history.status === 'error' || history.status === 'unavailable' ? <p role="alert">{history.status === 'unavailable' ? 'Sign-in history unavailable. ' : ''}{history.error}</p>
        : <LoginHistory records={history.items} />}
    {onRefresh && <button type="button" className="btn btn-secondary" disabled={history.status === 'loading'} onClick={onRefresh}>{history.status === 'error' || history.status === 'unavailable' ? 'Retry sign-in history' : 'Refresh sign-in history'}</button>}
  </div>;
}
