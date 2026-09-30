import useAuthorization from '../auth/useAuthorization.js';
import { AUTHORIZATION_MODES } from '../auth/AuthorizationProvider.jsx';
import { createProfileModel } from '../auth/profileModel.js';

const displayValue = (value) => value ?? 'Not available';

function ProfileField({ label, value }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={value === null ? 'profile-value-unavailable' : ''}>{displayValue(value)}</dd>
    </div>
  );
}

export default function Profile() {
  const { mode, effectiveRole, user } = useAuthorization();
  const previewRole = mode === AUTHORIZATION_MODES.ROLE_PREVIEW ? effectiveRole : null;
  const profile = createProfileModel(user, previewRole);

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
          <p className="profile-eyebrow">Future identity</p>
          <h2 id="profile-identity-heading">Profile information unavailable</h2>
          <p>Profile information will appear when an authenticated account is connected.</p>
        </div>
      </section>

      <div className="profile-grid">
        <section className="profile-section profile-section-wide" aria-labelledby="account-information-heading">
          <header>
            <h2 id="account-information-heading">Account Information</h2>
            <p>Identity and account details supplied by the future account service.</p>
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
            <h2 id="security-access-heading">Security &amp; Access</h2>
          </header>
          <dl className="profile-definition-list">
            <ProfileField label="Account Status" value={profile.fields.accountStatus} />
            <ProfileField label="Last Login" value={profile.fields.lastLoginAt} />
          </dl>
          <p className="profile-section-note">Security information will appear when identity services are connected.</p>
        </section>
      </div>
    </div>
  );
}
