import { Link } from 'react-router-dom';
import AuthLayout from './AuthLayout.jsx';
import { AUTH_ROUTES } from './authRoutes.js';

export default function AuthStatePage({ eyebrow, title, children, showSupport = false }) {
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
          <Link className={showSupport ? 'auth-text-action' : 'auth-secondary-action'} to={AUTH_ROUTES.LOGIN}>
            Back to Sign In
          </Link>
        </div>
      </div>
    </AuthLayout>
  );
}
