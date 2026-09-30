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

      <div className="settings-groups">
        <section className="settings-group" aria-labelledby="general-settings-heading">
          <header className="settings-group-header">
            <h2 id="general-settings-heading">General</h2>
            <p>Organization details and risk classification reference.</p>
          </header>
          <div className="settings-group-grid">
            <article className="settings-panel" aria-labelledby="organization-settings-heading">
              <div className="settings-panel-header">
                <h3 id="organization-settings-heading">Organization</h3>
              </div>
              <SettingsList items={[
                ['Organization Name', settings.organization.name],
                ['Currency', settings.organization.currency],
              ]} />
            </article>

            <article className="settings-panel" aria-labelledby="risk-settings-heading">
              <div className="settings-panel-header">
                <h3 id="risk-settings-heading">Risk Classification</h3>
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
              <p className="settings-note">Risk thresholds are shown for reference. Configuration editing is not available yet.</p>
            </article>
          </div>
        </section>

        <section className="settings-group" aria-labelledby="auditing-settings-heading">
          <header className="settings-group-header">
            <h2 id="auditing-settings-heading">Auditing</h2>
            <p>Control definitions, reporting, and alert requirements.</p>
          </header>
          <div className="settings-group-grid">
            <article className="settings-panel settings-panel-wide" aria-labelledby="rules-settings-heading">
              <div className="settings-panel-header settings-panel-header-with-link">
                <h3 id="rules-settings-heading">Audit Rules</h3>
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
            </article>

            <article className="settings-panel" aria-labelledby="report-settings-heading">
              <div className="settings-panel-header settings-panel-header-with-link">
                <h3 id="report-settings-heading">Reporting</h3>
                <Link className="card-header-link" to="/reports">View Reports</Link>
              </div>
              <SettingsList items={[
                ['Report Frequency', settings.reporting.frequency],
                ['Report Type', settings.reporting.reportType],
                ['Status', settings.reporting.status, 'defined'],
              ]} />
            </article>

            <article className="settings-panel" aria-labelledby="alert-settings-heading">
              <div className="settings-panel-header">
                <h3 id="alert-settings-heading">Real-Time Alerts</h3>
              </div>
              <SettingsList items={[
                ['Alert Threshold', settings.realTimeAlerts.threshold],
                ['Delivery', settings.realTimeAlerts.delivery],
                ['Target Alert Latency', settings.realTimeAlerts.targetLatency],
                ['Status', settings.realTimeAlerts.status, 'planned'],
              ]} />
            </article>
          </div>
        </section>

        <section className="settings-group" aria-labelledby="system-group-heading">
          <header className="settings-group-header">
            <h2 id="system-group-heading">System</h2>
            <p>Data connections and application information.</p>
          </header>
          <div className="settings-group-grid settings-system-grid">
            <article className="settings-panel" aria-labelledby="integration-settings-heading">
              <div className="settings-panel-header">
                <h3 id="integration-settings-heading">Data &amp; Integration</h3>
              </div>
              <SettingsList items={[
                ['Transaction Source', settings.integration.transactionSource],
                ['API Integration', settings.integration.apiIntegration, 'pending'],
                ['Real-Time Connection', settings.integration.realTimeConnection, 'pending'],
                ['Persistence', settings.integration.persistence, 'pending'],
              ]} />
            </article>

            <article className="settings-panel" aria-labelledby="system-settings-heading">
              <div className="settings-panel-header">
                <h3 id="system-settings-heading">System Information</h3>
              </div>
              <SettingsList items={[
                ['Frontend', settings.system.frontend],
                ['Interface Mode', settings.system.interfaceMode],
              ]} />
            </article>
          </div>
        </section>
      </div>
    </>
  );
}
