import DateTime from '../components/DateTime.jsx';
import { formatUtcDate } from '../utils/dateTime.js';
import {
  useMemo,
  useState,
  lazy,
  Suspense,
} from 'react';
import { Link } from 'react-router-dom';

import { DocIcon } from '../components/icons';
import {
  displayValue,
  formatAmount,
  formatScore,
  riskStatusPillClass,
} from '../components/statusUtils';
import usePagedResource from '../hooks/usePagedResource.js';
import CollectionPagination from '../components/CollectionPagination.jsx';
import useApp from '../context/useApp';
import { reportsService } from '../services/reportsService';
import useAuthorization from '../auth/useAuthorization.js';

const BusinessReports = lazy(() => import('../components/BusinessReports.jsx'));

function ReportRequestState({
  title,
  message,
  actionLabel,
  onAction,
}) {
  return (
    <section className="card report-empty-state" role="status">
      <h2>{title}</h2>
      <p>{message}</p>
      {actionLabel && onAction && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </section>
  );
}

export default function Reports() {
  const { effectiveRole } = useAuthorization();
  const [legacy, setLegacy] = useState(false);
  return <>
    {effectiveRole === 'ADMIN' && <div className="business-report-actions"><button type="button" className="btn btn-secondary" onClick={() => setLegacy((value) => !value)}>{legacy ? 'Open Business Reports' : 'Open Legacy Daily Summaries'}</button></div>}
    {legacy && effectiveRole === 'ADMIN' ? <LegacyReports /> : <Suspense fallback={<p role="status">Loading business reports…</p>}><BusinessReports /></Suspense>}
  </>;
}

function LegacyReports() {
  const { showNotification } = useApp();
  const collection = usePagedResource(reportsService.list);
  const reports = collection.items;
  const [selection, setSelection] = useState(null);
  const generatedOnThisPage = selection?.generated && selection.page === collection.query.page && selection.pageSize === collection.query.page_size;
  const selectedReport = reports.find((item) => item.id === selection?.report.id)
    ?? (generatedOnThisPage ? selection.report : reports[0]) ?? null;
  const loading = collection.status === 'loading';
  const [generating, setGenerating] = useState(false);
  const [actionError, setError] = useState(null);
  const error = collection.error || actionError;

  const report = selectedReport;
  const downloadUrl = useMemo(
    () => reportsService.getDownloadUrl(selectedReport?.id),
    [selectedReport?.id]
  );

  const downloadReport = async () => {
    if (!report?.id) return;
    try {
      const content = await reportsService.downloadExcel(report.id);
      const url = URL.createObjectURL(content);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${report.id}.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (downloadError) {
      const message = downloadError instanceof Error ? downloadError.message : 'The report could not be downloaded.';
      setError(message);
      showNotification(message, 'error');
    }
  };

  const generateReport = async () => {
    if (generating) return;

    setGenerating(true);
    setError(null);

    try {
      const generated = await reportsService.generateLatest();

      if (!generated?.id) {
        throw new Error(
          'The generated report response was invalid.'
        );
      }

      setSelection({ report: generated, generated: true, page: 1, pageSize: collection.query.page_size });
      await collection.resource.setPage(1);
      showNotification(
        'Daily audit report generated successfully.',
        'success'
      );
    } catch (generationError) {
      const message = generationError instanceof Error
        ? generationError.message
        : 'The report could not be generated.';

      setError(message);
      showNotification(message, 'error');
    } finally {
      setGenerating(false);
    }
  };

  const summaryItems = report
    ? [
      [
        'Total Transactions',
        report.dailySummary.totalTransactions,
        'blue',
      ],
      [
        'Transactions Evaluated',
        report.dailySummary.transactionsEvaluated,
        'green',
      ],
      [
        'High-Risk Transactions',
        report.dailySummary.highRiskTransactions,
        'red',
      ],
      [
        'Average Risk Score',
        report.dailySummary.averageRiskScore === null
          ? 'Not available'
          : `${report.dailySummary.averageRiskScore}/100`,
        'orange',
      ],
      [
        'Active Alerts',
        report.dailySummary.activeAlerts,
        'blue',
      ],
      [
        'Reviewed Alerts',
        report.dailySummary.reviewedAlerts,
        'green',
      ],
    ]
    : [];

  const alertItems = report
    ? [
      ['Total Alerts', report.alertSummary.total],
      ['Active Alerts', report.alertSummary.active],
      ['Reviewed Alerts', report.alertSummary.reviewed],
      ['High-Risk Alerts', report.alertSummary.high],
      ['Medium-Risk Alerts', report.alertSummary.medium],
    ]
    : [];

  return (
    <>
      <div className="page-header reports-page-header">
        <div>
          <h1>Reports</h1>
          <p>
            Review persisted daily audit summaries and
            authoritative risk activity.
          </p>
        </div>
        <span className="report-preview-status">
          {report
            ? `Daily Summary · ${displayValue(report.status)}`
            : 'Daily Summary'}
        </span>
      </div>

      <CollectionPagination collection={collection} itemLabel="saved daily summaries" disabled={generating} />

      {loading ? (
        <ReportRequestState
          title="Loading reports…"
          message="Retrieving persisted reports from the audit service."
        />
      ) : error && !report ? (
        <ReportRequestState
          title="Reports could not be loaded."
          message={error}
          actionLabel="Try Again"
          onAction={() => { setError(null); collection.resource.load(); }}
        />
      ) : !report ? (
        <ReportRequestState
          title={collection.total > 0 ? 'No reports on this page.' : 'No persisted reports are available.'}
          message={collection.total > 0 ? 'Refresh or browse another saved reports page.' : 'Generate a report for the latest dated transaction day to begin.'}
          actionLabel={collection.total > 0 ? 'Refresh' : generating ? 'Generating…' : 'Generate Report'}
          onAction={collection.total > 0 ? () => collection.resource.load() : generateReport}
        />
      ) : (
        <>
          <section
            className="card report-preview-intro"
            aria-labelledby="report-information-heading"
          >
            <div>
              <span className="report-section-eyebrow">
                Persisted report
              </span>
              <h2 id="report-information-heading">
                Report Information
              </h2>
              <dl className="report-information-list">
                <div>
                  <dt>Report</dt>
                  <dd>
                    <select
                      className="select-input"
                      value={report.id}
                      onChange={(event) => {
                        const selected = reports.find(
                          (item) => item.id === event.target.value
                        );
                        setSelection({ report: selected ?? report });
                      }}
                    >
                      {!reports.some((item) => item.id === report.id) && <option value={report.id}>{report.id} (generated; outside this saved page)</option>}
                      {reports.map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.id}
                        </option>
                      ))}
                    </select>
                  </dd>
                </div>
                <div>
                  <dt>Report Type</dt>
                  <dd>{displayValue(report.type)}</dd>
                </div>
                <div>
                  <dt>Report Status</dt>
                  <dd>
                    <span className="report-status-badge">
                      {displayValue(report.status)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Period Start</dt>
                  <dd>{formatUtcDate(report.periodStart)} UTC</dd>
                </div>
                <div>
                  <dt>Period End</dt>
                  <dd>
                    {formatUtcDate(report.periodEnd)} UTC
                    {' (exclusive)'}
                  </dd>
                </div>
                <div>
                  <dt>Completed</dt>
                  <dd>
                    <DateTime value={report.completedAt} utc />
                  </dd>
                </div>
                <div>
                  <dt>Report Version</dt>
                  <dd>{displayValue(report.reportVersion)}</dd>
                </div>
              </dl>
            </div>

            <div className="report-actions">
              <a
                className="btn btn-secondary"
                href="#daily-summary-heading"
              >
                View Daily Summary
              </a>

              <button
                type="button"
                className="btn btn-primary"
                disabled={generating}
                onClick={generateReport}
              >
                <DocIcon
                  width={15}
                  height={15}
                  aria-hidden="true"
                />
                {generating
                  ? 'Generating…'
                  : 'Generate Latest Activity'}
              </button>

              {downloadUrl && report.status === 'COMPLETED' && (
                <button type="button" className="btn btn-secondary" onClick={downloadReport}>
                  Download Excel
                </button>
              )}

              {error && (
                <p role="alert">{error}</p>
              )}
            </div>
          </section>

          <section
            className="report-section"
            aria-labelledby="daily-summary-heading"
          >
            <div className="report-section-header">
              <div>
                <span className="report-section-eyebrow">
                  Authoritative daily activity
                </span>
                <h2 id="daily-summary-heading" tabIndex="-1">
                  Daily Audit Summary
                </h2>
              </div>
            </div>

            <div className="report-summary-grid">
              {summaryItems.map(([label, value, tone]) => (
                <div
                  className="card report-summary-item"
                  key={label}
                >
                  <span>{label}</span>
                  <strong className={`report-value-${tone}`}>
                    {typeof value === 'number'
                      ? value.toLocaleString('en-US')
                      : value}
                  </strong>
                </div>
              ))}
            </div>
          </section>

          <div className="reports-two-column-grid">
            <section
              className="card report-detail-card"
              aria-labelledby="risk-distribution-heading"
            >
              <div className="card-header">
                <h2 id="risk-distribution-heading">
                  Risk Distribution
                </h2>
              </div>

              <div className="report-risk-list">
                {report.riskDistribution.map((risk) => (
                  <div
                    className="report-risk-row"
                    key={risk.key}
                  >
                    <span
                      className={`risk-badge badge-${risk.key}`}
                    >
                      {risk.label}
                    </span>
                    <span>
                      <strong>{risk.count}</strong> transactions
                    </span>
                    <strong>{risk.percentage}%</strong>
                  </div>
                ))}
              </div>
            </section>

            <section
              className="card report-detail-card"
              aria-labelledby="alert-summary-heading"
            >
              <div className="card-header report-card-header-with-link">
                <h2 id="alert-summary-heading">
                  Alert Summary
                </h2>
                <Link className="card-header-link" to="/alerts">
                  View All Alerts
                </Link>
              </div>

              <dl className="report-alert-list">
                {alertItems.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>

          <section
            className="card report-detail-card"
            aria-labelledby="rule-summary-heading"
          >
            <div className="card-header">
              <div>
                <h2 id="rule-summary-heading">
                  Audit Rule Summary
                </h2>
                <p>
                  Violations recorded in authoritative evaluation
                  snapshots.
                </p>
              </div>
            </div>

            {report.ruleSummary.length > 0 ? (
              <div className="report-rule-list">
                {report.ruleSummary.map((rule) => (
                  <div
                    className="report-rule-row"
                    key={rule.id}
                  >
                    <span className="report-rule-id">
                      {displayValue(rule.id)}
                    </span>
                    <strong>{displayValue(rule.name)}</strong>
                    <span className="report-violation-count">
                      {rule.violationCount}{' '}
                      {rule.violationCount === 1
                        ? 'violation'
                        : 'violations'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="report-empty-state" role="status">
                <h3>No rule violations were recorded.</h3>
              </div>
            )}
          </section>

          <section
            className="card report-detail-card"
            aria-labelledby="high-risk-heading"
          >
            <div className="card-header">
              <div>
                <h2 id="high-risk-heading">
                  High-Risk Transactions
                </h2>
                <p>
                  Transactions classified as high risk in this
                  persisted report.
                </p>
              </div>
              <Link
                className="card-header-link"
                to="/transactions?risk=high"
              >
                View High-Risk Transactions
              </Link>
            </div>

            {report.highRiskTransactions.length > 0 ? (
              <LegacyReportTransactions transactions={report.highRiskTransactions} />
            ) : (
              <div className="report-empty-state" role="status">
                <h3>
                  No high-risk transactions in this report.
                </h3>
                <p>
                  High-risk transactions will appear after the next
                  authoritative report generation.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

export function LegacyReportTransactions({ transactions }) {
  return (
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
          {transactions.map(
            (transaction) => (
              <tr key={transaction.id}>
                <td data-label="Transaction ID">
                  <Link
                    to={`/transactions/${transaction.id}`}
                  >
                    {displayValue(transaction.id)}
                  </Link>
                </td>
                <td data-label="Vendor">
                  {displayValue(transaction.vendor)}
                </td>
                <td data-label="Amount">
                  {formatAmount(transaction.amount, transaction.currency)}
                </td>
                <td data-label="Risk Score">
                  {formatScore(transaction.riskScore)}
                </td>
                <td data-label="Risk Level">
                  <span
                    className={riskStatusPillClass(
                      'High Risk'
                    )}
                  >
                    High Risk
                  </span>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
