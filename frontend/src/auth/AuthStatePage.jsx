import { Link } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { AUTH_ROUTES } from './authRoutes.js';

export default function AuthStatePage({ eyebrow, title, children, showSupport = false, signInLabel = 'Back to Sign In', primarySignIn = false }) {
  return (
    <AuthLayout hideSupportFooterLink={showSupport}>
      <div className="auth-state-content">
        <header className="auth-form-header">
          <p className="auth-form-eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </header>
        <div className="auth-state-copy">{children}</div>
        <div className="auth-state-actions">
          {showSupport && <Link className="auth-secondary-action" to={AUTH_ROUTES.SUPPORT}>Contact Support</Link>}
          <Link className={primarySignIn ? 'auth-submit' : showSupport ? 'auth-text-action' : 'auth-secondary-action'} to={AUTH_ROUTES.LOGIN}>
            {signInLabel}
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
