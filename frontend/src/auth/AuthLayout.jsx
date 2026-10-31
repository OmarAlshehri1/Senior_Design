import { ShieldIcon } from '../components/icons';
import AuthFooter from './AuthFooter.jsx';
import '../pages/Login.css';

const LEDGER = Object.freeze([['low', 72], ['low', 54], ['medium', 81], ['low', 63], ['high', 46], ['low', 70]]);

export default function AuthLayout({ children, panelClassName = '', hideSupportFooterLink = false }) {
  const panelClasses = ['auth-form-panel', panelClassName].filter(Boolean).join(' ');

  return (
    <main className="auth-page">
      <section className="auth-context" aria-labelledby="auth-system-title">
        <div className="auth-context-brand">
          <span className="auth-brand-mark" aria-hidden="true"><ShieldIcon width={20} height={20} /></span>
          <span className="auth-context-label">Audit System</span>
        </div>
        <div className="auth-context-content">
          <h1 id="auth-system-title">Continuous Auditing System</h1>
          <p className="auth-context-copy">Every payment checked against your controls, with risk explained and every review on record.</p>
          <div className="auth-ledger" aria-hidden="true">
            {LEDGER.map(([tone, width], index) => <div className="auth-ledger-row" key={index}>
              <span className={`auth-ledger-dot is-${tone}`} /><span className="auth-ledger-bar" style={{ width: `${width}%` }} /><span className={`auth-ledger-tag is-${tone}`} />
            </div>)}
          </div>
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
