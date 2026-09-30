import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { DocIcon } from '../components/icons';
import { displayValue, formatSAR, formatScore, riskStatusPillClass } from '../components/statusUtils';
import useApp from '../context/useApp';
import { deriveReportPreview } from '../utils/reports';

function formatPreviewDate(timestamp) {
  if (!timestamp) return 'No transaction date available';

  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }).format(new Date(timestamp));
}

export default function Reports() {
  const { transactions, alerts } = useApp();
  const report = useMemo(
    () => deriveReportPreview(transactions, alerts),
    [transactions, alerts]
  );

  const summaryItems = [
    ['Total Transactions', report.dailySummary.totalTransactions, 'blue'],
    ['Transactions Evaluated', report.dailySummary.transactionsEvaluated, 'green'],
    ['High-Risk Transactions', report.dailySummary.highRiskTransactions, 'red'],
    ['Average Risk Score', `${report.dailySummary.averageRiskScore}/100`, 'orange'],
    ['Active Alerts', report.dailySummary.activeAlerts, 'blue'],
    ['Reviewed Alerts', report.dailySummary.reviewedAlerts, 'green'],
  ];

  const alertItems = [
    ['Total Alerts', report.alertSummary.total],
    ['Active Alerts', report.alertSummary.active],
    ['Reviewed Alerts', report.alertSummary.reviewed],
    ['High-Risk Alerts', report.alertSummary.high],
    ['Medium-Risk Alerts', report.alertSummary.medium],
  ];

  return (
    <>
      <div className="page-header reports-page-header">
        <div>
          <h1>Reports</h1>
          <p>Review daily audit summaries and transaction risk activity.</p>
        </div>
        <span className="report-preview-status">Daily Summary · Preview</span>
      </div>

      <section className="card report-preview-intro" aria-labelledby="report-information-heading">
        <div>
          <span className="report-section-eyebrow">Report overview</span>
          <h2 id="report-information-heading">Report Information</h2>
          <dl className="report-information-list">
            <div><dt>Report Type</dt><dd>Daily Audit Summary</dd></div>
            <div><dt>Data Source</dt><dd>Current Dataset</dd></div>
            <div><dt>Report Status</dt><dd><span className="report-status-badge">Preview</span></dd></div>
            <div><dt>Preview Date</dt><dd>{formatPreviewDate(report.previewDate)}</dd></div>
          </dl>
        </div>
        <div className="report-actions">
          <a className="btn btn-secondary" href="#daily-summary-heading">View Daily Summary</a>
          <button
            type="button"
            className="btn btn-primary"
            disabled
            aria-describedby="report-generation-help"
            title="Report file generation is not available yet."
          >
            <DocIcon width={15} height={15} aria-hidden="true" />
            Generate Report
          </button>
          <p id="report-generation-help">
            Report file generation is not available yet.
          </p>
        </div>
      </section>

      <section className="report-section" aria-labelledby="daily-summary-heading">
        <div className="report-section-header">
          <div>
            <span className="report-section-eyebrow">Daily activity</span>
            <h2 id="daily-summary-heading" tabIndex="-1">Daily Audit Summary</h2>
          </div>
        </div>
        <div className="report-summary-grid">
          {summaryItems.map(([label, value, tone]) => (
            <div className="card report-summary-item" key={label}>
              <span>{label}</span>
              <strong className={`report-value-${tone}`}>
                {typeof value === 'number' ? value.toLocaleString('en-US') : value}
              </strong>
            </div>
          ))}
        </div>
      </section>

      <div className="reports-two-column-grid">
        <section className="card report-detail-card" aria-labelledby="risk-distribution-heading">
          <div className="card-header">
            <h2 id="risk-distribution-heading">Risk Distribution</h2>
          </div>
          <div className="report-risk-list">
            {report.riskDistribution.map((risk) => (
              <div className="report-risk-row" key={risk.key}>
                <span className={`risk-badge badge-${risk.key}`}>{risk.label}</span>
                <span><strong>{risk.count}</strong> transactions</span>
                <strong>{risk.percentage}%</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="card report-detail-card" aria-labelledby="alert-summary-heading">
          <div className="card-header report-card-header-with-link">
            <h2 id="alert-summary-heading">Alert Summary</h2>
            <Link className="card-header-link" to="/alerts">View All Alerts</Link>
          </div>
          <dl className="report-alert-list">
            {alertItems.map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
        </section>
      </div>

      <section className="card report-detail-card" aria-labelledby="rule-summary-heading">
        <div className="card-header">
          <div>
            <h2 id="rule-summary-heading">Audit Rule Summary</h2>
            <p>Recorded violations in evaluated transaction evidence.</p>
          </div>
        </div>
        <div className="report-rule-list">
          {report.ruleSummary.map((rule) => (
            <div className="report-rule-row" key={rule.id}>
              <span className="report-rule-id">{rule.id}</span>
              <strong>{rule.name}</strong>
              <span className="report-violation-count">
                {rule.violationCount} {rule.violationCount === 1 ? 'violation' : 'violations'}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="card report-detail-card" aria-labelledby="high-risk-heading">
        <div className="card-header">
          <div>
            <h2 id="high-risk-heading">High-Risk Transactions</h2>
            <p>Transactions currently classified as high risk.</p>
          </div>
          <Link className="card-header-link" to="/transactions?risk=high">View All High-Risk Transactions</Link>
        </div>
        {report.highRiskTransactions.length > 0 ? (
          <div className="report-transactions-wrap">
            <table className="data-table report-transactions-table">
              <thead>
                <tr>
                  <th>Transaction ID</th>
                  <th>Vendor</th>
                  <th>Amount</th>
                  <th>Risk Score</th>
                  <th>Risk Level</th>
                </tr>
              </thead>
              <tbody>
                {report.highRiskTransactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td data-label="Transaction ID">
                      <Link to={`/transactions/${transaction.id}`}>{displayValue(transaction.id)}</Link>
                    </td>
                    <td data-label="Vendor">{displayValue(transaction.vendor)}</td>
                    <td data-label="Amount">{formatSAR(transaction.amount)}</td>
                    <td data-label="Risk Score">{formatScore(transaction.riskScore)}</td>
                    <td data-label="Risk Level">
                      <span className={riskStatusPillClass('High Risk')}>High Risk</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="report-empty-state" role="status">
            <h3>No high-risk transactions in the current dataset.</h3>
            <p>Transactions classified as high risk will appear in this preview.</p>
          </div>
        )}
      </section>
    </>
  );
}
