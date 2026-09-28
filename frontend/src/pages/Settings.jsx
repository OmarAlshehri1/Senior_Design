import { Link } from 'react-router-dom';
import { getSettingsOverview } from '../utils/settings';

function SettingsList({ items }) {
  return (
    <dl className="settings-definition-list">
      {items.map(([label, value, statusTone]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={statusTone ? `settings-status status-${statusTone}` : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function Settings() {
  const settings = getSettingsOverview();

  return (
    <>
      <div className="page-header settings-page-header">
        <div>
          <h1>Settings</h1>
          <p>Review system configuration and audit preferences.</p>
        </div>
        <span className="settings-mode-badge">Read-only overview</span>
      </div>

      <div className="settings-grid">
        <section className="card settings-card" aria-labelledby="organization-settings-heading">
          <div className="settings-card-header">
            <div>
              <span className="settings-section-eyebrow">Workspace</span>
              <h2 id="organization-settings-heading">Organization</h2>
            </div>
          </div>
          <SettingsList items={[
            ['Organization Name', settings.organization.name],
            ['Currency', settings.organization.currency],
          ]} />
        </section>

        <section className="card settings-card" aria-labelledby="risk-settings-heading">
          <div className="settings-card-header">
            <div>
              <span className="settings-section-eyebrow">Reference</span>
              <h2 id="risk-settings-heading">Risk Classification</h2>
            </div>
          </div>
          <div className="settings-risk-list">
            {settings.riskClassification.map((risk) => (
              <div key={risk.label}>
                <span className={`risk-badge badge-${risk.label.split(' ')[0].toLowerCase()}`}>
                  {risk.label}
                </span>
                <strong>{risk.range}</strong>
              </div>
            ))}
          </div>
          <p className="settings-note">
            Risk thresholds are shown for reference and will be managed through system configuration when backend persistence is available.
          </p>
        </section>

        <section className="card settings-card settings-card-wide" aria-labelledby="rules-settings-heading">
          <div className="settings-card-header settings-card-header-with-link">
            <div>
              <span className="settings-section-eyebrow">Control definitions</span>
              <h2 id="rules-settings-heading">Audit Rules</h2>
            </div>
            <Link className="card-header-link" to="/audit-rules">View Audit Rules</Link>
          </div>
          <div className="settings-rule-list">
            {settings.auditRules.map((rule) => (
              <div key={rule.id}>
                <span className="settings-rule-id">{rule.id}</span>
                <strong>{rule.name}</strong>
                <span className="settings-status status-defined">{rule.status}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card settings-card" aria-labelledby="report-settings-heading">
          <div className="settings-card-header settings-card-header-with-link">
            <div>
              <span className="settings-section-eyebrow">Report requirement</span>
              <h2 id="report-settings-heading">Reporting</h2>
            </div>
            <Link className="card-header-link" to="/reports">View Reports</Link>
          </div>
          <SettingsList items={[
            ['Report Frequency', settings.reporting.frequency],
            ['Report Type', settings.reporting.reportType],
            ['Status', settings.reporting.status, 'defined'],
          ]} />
        </section>

        <section className="card settings-card" aria-labelledby="alert-settings-heading">
          <div className="settings-card-header">
            <div>
              <span className="settings-section-eyebrow">Project requirement</span>
              <h2 id="alert-settings-heading">Real-Time Alerts</h2>
            </div>
          </div>
          <SettingsList items={[
            ['Alert Threshold', settings.realTimeAlerts.threshold],
            ['Delivery', settings.realTimeAlerts.delivery],
            ['Target Alert Latency', settings.realTimeAlerts.targetLatency],
            ['Status', settings.realTimeAlerts.status, 'planned'],
          ]} />
        </section>

        <section className="card settings-card" aria-labelledby="integration-settings-heading">
          <div className="settings-card-header">
            <div>
              <span className="settings-section-eyebrow">Current frontend state</span>
              <h2 id="integration-settings-heading">Data &amp; Integration</h2>
            </div>
          </div>
          <SettingsList items={[
            ['Transaction Source', settings.integration.transactionSource],
            ['API Integration', settings.integration.apiIntegration, 'pending'],
            ['Real-Time Connection', settings.integration.realTimeConnection, 'pending'],
            ['Persistence', settings.integration.persistence, 'pending'],
          ]} />
        </section>

        <section className="card settings-card" aria-labelledby="system-settings-heading">
          <div className="settings-card-header">
            <div>
              <span className="settings-section-eyebrow">Application</span>
              <h2 id="system-settings-heading">System Information</h2>
            </div>
          </div>
          <SettingsList items={[
            ['Frontend', settings.system.frontend],
            ['Interface Mode', settings.system.interfaceMode],
          ]} />
        </section>
      </div>
    </>
  );
}
