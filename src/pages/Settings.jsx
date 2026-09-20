import { auditRules } from '../data/mockData';

export default function Settings() {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Organization and audit configuration for this prototype.</p>
        </div>
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 18 }}>
        <h2 style={{ fontSize: 15, margin: '0 0 14px 0' }}>Organization</h2>
        <div className="summary-list-row" style={{ marginBottom: 8 }}>
          <span className="k">Organization Name</span>
          <span className="v">Retail Store Operations</span>
        </div>
        <div className="summary-list-row" style={{ marginBottom: 8 }}>
          <span className="k">Currency</span>
          <span className="v">SAR (Saudi Riyal)</span>
        </div>
        <div className="summary-list-row">
          <span className="k">Monitoring</span>
          <span className="v" style={{ color: 'var(--green)' }}>Active</span>
        </div>
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h2 style={{ fontSize: 15, margin: '0 0 14px 0' }}>Active Audit Rules</h2>
        {auditRules.map((rule) => (
          <div className="summary-list-row" key={rule.key} style={{ marginBottom: 8 }}>
            <span className="k">{rule.label}</span>
            <span className="active-pill">{rule.status}</span>
          </div>
        ))}
      </div>
    </>
  );
}
