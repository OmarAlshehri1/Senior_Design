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
  const [history, setHistory] = useState([]);
  const previewRole = mode === AUTHORIZATION_MODES.ROLE_PREVIEW ? effectiveRole : null;
  const profile = createProfileModel(user, previewRole);
  const securityActivity = createSecurityActivity();

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    userManagementService.listLoginHistory(user.id, { query: { page: 1, page_size: 20 } })
      .then((page) => { if (active) setHistory((page?.items ?? []).map((item) => ({ id: item.id, outcome: item.outcome, timestamp: item.created_at }))); })
      .catch(() => { if (active) setHistory([]); });
    return () => { active = false; };
  }, [user?.id]);

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
            <ProfileField label="Last Login" value={profile.fields.lastLoginAt} />
          </dl>
        </section>

        <section className="profile-section" aria-labelledby="my-activity-heading">
          <header>
            <h2 id="my-activity-heading">My Activity</h2>
          </header>
          <dl className="profile-definition-list">
            <ProfileField label="Reviews Completed" value={profile.fields.reviewsCompleted} />
            <ProfileField label="Alerts Assigned" value={profile.fields.alertsAssigned} />
            <ProfileField label="Last Review" value={profile.fields.lastReviewAt} />
          </dl>
        </section>

        <section className="profile-section" aria-labelledby="security-access-heading">
          <header>
            <h2 id="security-access-heading">Sign-In &amp; Security Activity</h2>
          </header>
          <dl className="profile-definition-list">
            <ProfileField label="Last Login" value={user?.lastLoginAt ?? securityActivity.lastLoginAt} unavailableLabel="—" />
            <ProfileField label="Failed Sign-In Attempts" value={user?.failedSignInAttempts ?? securityActivity.failedSignInAttempts} unavailableLabel="—" />
            <ProfileField label="Account Status" value={user?.accountStatus ?? securityActivity.accountStatus} unavailableLabel="—" />
          </dl>
          <div className="profile-login-history">
            <h3>Recent Sign-In Activity</h3>
            <LoginHistory records={history} />
          </div>
        </section>
      </div>
    </div>
  );
}
