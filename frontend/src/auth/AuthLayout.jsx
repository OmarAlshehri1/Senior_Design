import { ShieldIcon } from '../components/icons';
import AuthFooter from './AuthFooter.jsx';
import '../pages/Login.css';

export default function AuthLayout({ children, panelClassName = '', hideSupportFooterLink = false }) {
  const panelClasses = ['auth-form-panel', panelClassName].filter(Boolean).join(' ');

  return (
    <main className="auth-page">
      <section className="auth-context" aria-labelledby="auth-system-title">
        <div className="auth-context-content">
          <div className="auth-brand-mark" aria-hidden="true">
            <ShieldIcon width={24} height={24} />
          </div>
          <p className="auth-context-label">Continuous auditing</p>
          <h1 id="auth-system-title">Continuous Auditing System</h1>
          <p className="auth-context-copy">
            Secure access to transaction monitoring, audit alerts, and review workflows.
          </p>
        </div>
        <p className="auth-provisioning-note">Accounts are provisioned by your organization.</p>
      </section>

      <section className="auth-form-region" aria-label="Account access">
        <div className={panelClasses}>
          {children}
          <AuthFooter hideSupport={hideSupportFooterLink} />
        </div>
      </section>
    </main>
  );
}
