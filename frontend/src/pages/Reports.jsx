import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Link } from 'react-router-dom';

import { DocIcon } from '../components/icons';
import {
  displayValue,
  formatSAR,
  formatScore,
  riskStatusPillClass,
} from '../components/statusUtils';
import useApp from '../context/useApp';
import { reportsService } from '../services/reportsService';

function formatReportDate(timestamp) {
  if (!timestamp) return 'Not available';

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeZone: 'UTC',
  }).format(new Date(timestamp));
}

function formatReportTimestamp(timestamp) {
  if (!timestamp) return 'Not available';

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(timestamp));
}

function buildTodayUtcPeriod(now = new Date()) {
  const periodStart = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  ));
  const periodEnd = new Date(periodStart);
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 1);

  return {
    type: 'DAILY',
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
  };
}

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
  const { showNotification } = useApp();
  const [reports, setReports] = useState([]);
  const [selectedReport, setSelectedReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function loadReports() {
      setLoading(true);
      setError(null);

      try {
        const result = await reportsService.list({
          query: {
            page: 1,
            page_size: 25,
          },
          signal: controller.signal,
        });

        if (!active) return;

        setReports(result.items);
        setSelectedReport((current) => (
          result.items.find(
            (report) => report.id === current?.id
          )
          ?? result.items[0]
          ?? null
        ));
      } catch (loadError) {
        if (!active || controller.signal.aborted) return;

        setReports([]);
        setSelectedReport(null);
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Reports could not be loaded.'
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadReports();

    return () => {
      active = false;
      controller.abort();
    };
  }, [reloadKey]);

  const report = selectedReport;
  const downloadUrl = useMemo(
    () => reportsService.getDownloadUrl(selectedReport?.id),
    [selectedReport?.id]
  );

  const downloadReport = async () => {
    if (!report?.id) return;
    try {
      const content = await reportsService.download(report.id);
      const url = URL.createObjectURL(content);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${report.id}.csv`;
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
      const generated = await reportsService.generate(
        buildTodayUtcPeriod()
      );

      if (!generated?.id) {
        throw new Error(
          'The generated report response was invalid.'
        );
      }

      setReports((previous) => [
        generated,
        ...previous.filter(
          (report) => report.id !== generated.id
        ),
      ]);
      setSelectedReport(generated);
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
          onAction={() => setReloadKey((value) => value + 1)}
        />
      ) : !report ? (
        <ReportRequestState
          title="No persisted reports are available."
          message="Generate today's UTC audit report to begin."
          actionLabel={
            generating ? 'Generating…' : 'Generate Report'
          }
          onAction={generateReport}
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
                        setSelectedReport(selected ?? report);
                      }}
                    >
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
                  <dd>{formatReportDate(report.periodStart)} UTC</dd>
                </div>
                <div>
                  <dt>Period End</dt>
                  <dd>
                    {formatReportDate(report.periodEnd)} UTC
                    {' (exclusive)'}
                  </dd>
                </div>
                <div>
                  <dt>Completed</dt>
                  <dd>
                    {formatReportTimestamp(report.completedAt)} UTC
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
                  : 'Generate Today'}
              </button>

              {downloadUrl && report.status === 'COMPLETED' && (
                <button type="button" className="btn btn-secondary" onClick={downloadReport}>
                  Download CSV
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
                    {report.highRiskTransactions.map(
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
                            {formatSAR(transaction.amount)}
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
