import { Link } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout.jsx';
import { AUTH_ROUTES } from '../auth/authRoutes.js';

export default function PrivacySecurity() {
  return (
    <AuthLayout>
      <div className="auth-state-content">
        <header className="auth-form-header">
          <p className="auth-form-eyebrow">Responsible access</p>
          <h2>Privacy &amp; Security</h2>
          <p>Important guidance for using this internal auditing system.</p>
        </header>
        <ul className="auth-guidance-list">
          <li>Access is restricted to authorized users.</li>
          <li>Account activity may be recorded for audit and security purposes.</li>
          <li>Users should not share account credentials.</li>
          <li>Suspected unauthorized access should be reported to the system administrator.</li>
        </ul>
        <div className="auth-state-actions">
          <Link className="auth-secondary-action" to={AUTH_ROUTES.LOGIN}>Back to Sign In</Link>
        </div>
      </div>
    </AuthLayout>
  );
}
