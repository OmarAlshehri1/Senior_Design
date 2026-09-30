import AuthStatePage from '../auth/AuthStatePage.jsx';

export function AccessPending() {
  return (
    <AuthStatePage eyebrow="Account access" title="Access Request Pending">
      <p>Your request is awaiting administrator review.</p>
      <p>You will be able to sign in after your account has been approved and activated.</p>
    </AuthStatePage>
  );
}

export function AccountLocked() {
  return (
    <AuthStatePage eyebrow="Account status" title="Account Locked" showSupport>
      <p>Your account is currently locked.</p>
      <p>Contact your administrator for assistance restoring access.</p>
    </AuthStatePage>
  );
}

export function AccountDisabled() {
  return (
    <AuthStatePage eyebrow="Account status" title="Account Unavailable" showSupport>
      <p>This account is currently disabled.</p>
      <p>Contact your administrator if you believe this is unexpected.</p>
    </AuthStatePage>
  );
}

export function SessionExpired() {
  return (
    <AuthStatePage eyebrow="Account session" title="Session Expired" signInLabel="Return to Sign In" primarySignIn>
      <p>Your session has ended. Sign in again to continue.</p>
    </AuthStatePage>
  );
}

export function AuthenticationRequired() {
  return (
    <AuthStatePage eyebrow="Account access" title="Authentication Required" signInLabel="Return to Sign In" primarySignIn>
      <p>No valid session is available. Sign in to continue.</p>
    </AuthStatePage>
  );
}
