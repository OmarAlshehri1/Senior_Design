import { Link } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout.jsx';
import { AUTH_ROUTES } from '../auth/authRoutes.js';
import { getSupportPresentation } from '../auth/supportConfig.js';

export default function Support() {
  const support = getSupportPresentation();

  return (
    <AuthLayout hideSupportFooterLink>
      <div className="auth-state-content">
        <header className="auth-form-header">
          <p className="auth-form-eyebrow">Account assistance</p>
          <h2>Need help?</h2>
        </header>
        <div className="auth-state-copy">
          <p>For account access or sign-in assistance, contact your system administrator.</p>
          {support.contact && <a href={support.contact.href}>{support.contact.label}</a>}
        </div>
        <div className="auth-state-actions">
          <Link className="auth-secondary-action" to={AUTH_ROUTES.LOGIN}>Back to Sign In</Link>
        </div>
      </div>
    </AuthLayout>
  );
}
