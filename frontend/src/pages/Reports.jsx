import useApp from '../context/useApp';
import { DocIcon } from '../components/icons';

export default function Reports() {
  const { summary, alerts, riskOverview } = useApp();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Reports</h1>
          <p>Frontend-only report preview based on the current simulated dataset.</p>
        </div>
      </div>

      <div className="report-grid">
        <div className="card report-stat">
          <div className="label">Total Transactions</div>
          <div className="value">{summary.totalTransactions.toLocaleString('en-US')}</div>
        </div>
        <div className="card report-stat">
          <div className="label">Evaluated Transactions</div>
          <div className="value" style={{ color: 'var(--green)' }}>
            {summary.transactionsEvaluated.toLocaleString('en-US')}
          </div>
        </div>
        <div className="card report-stat">
          <div className="label">High-Risk Transactions</div>
          <div className="value" style={{ color: 'var(--red)' }}>
            {summary.highRiskTransactions}
          </div>
        </div>
        <div className="card report-stat">
          <div className="label">Total Alerts</div>
          <div className="value">{alerts.length}</div>
        </div>
        <div className="card report-stat">
          <div className="label">Average Risk Score</div>
          <div className="value" style={{ color: 'var(--orange)' }}>
            {summary.averageRiskScore}/100
          </div>
        </div>
        <div className="card report-stat">
          <div className="label">Risk Distribution</div>
          <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 13.5 }}>
            <span style={{ color: 'var(--green)', fontWeight: 700 }}>{riskOverview.low}% Low</span>
            <span style={{ color: 'var(--orange)', fontWeight: 700 }}>{riskOverview.medium}% Medium</span>
            <span style={{ color: 'var(--red)', fontWeight: 700 }}>{riskOverview.high}% High</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 22 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div>
            <h3 style={{ margin: '0 0 4px 0', fontSize: 15 }}>Daily Audit Report Generation</h3>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
              File generation will be available after backend integration.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            title="Available after backend integration"
            disabled
          >
            <DocIcon width={15} height={15} />
            Backend Required to Generate Report
          </button>
        </div>
      </div>
    </>
  );
}
