import { Link, useParams } from 'react-router-dom';
import useApp from '../context/useApp';
import {
  displayValue,
  formatAmount,
  formatScore,
  riskBadgeClass,
  ruleStatusPillClass,
} from '../components/statusUtils';
import { ArrowLeftIcon } from '../components/icons';
import { getRiskLevel } from '../utils/risk';
import { AUDIT_RULE_DEFINITIONS, getTransactionDataQuality } from '../utils/transactions';
import ReviewHistory from '../components/ReviewHistory.jsx';
import { createReviewAccountability } from '../audit/reviewRecords.js';
import { REVIEW_RESOLUTIONS } from '../cases/caseWorkflow.js';
import VendorMonitoringIndicator from '../components/VendorMonitoringIndicator.jsx';

function DetailField({ label, value }) {
  return (
    <div className="transaction-info-item">
      <dt>{label}</dt>
      <dd>{displayValue(value)}</dd>
    </div>
  );
}

function DetailNotFound({ id }) {
  return (
    <div className="card transaction-not-found">
      <span className="transaction-not-found-label">Transaction lookup</span>
      <h1>Transaction not found.</h1>
      <p>No evaluated transaction exists with the ID “{displayValue(id)}”.</p>
      <Link className="btn btn-primary" to="/transactions">
        <ArrowLeftIcon width={15} height={15} />
        Back to Transactions
      </Link>
    </div>
  );
}

export default function TransactionDetail() {
  const { id } = useParams();
  const { getTransaction, getAlertForTransaction, markAlertReviewed, showNotification } = useApp();
  const transaction = getTransaction(id);
  const alert = getAlertForTransaction(id);

  if (!transaction) return <DetailNotFound id={id} />;

  if (transaction.processing) {
    return (
      <div className="card transaction-processing-state" role="status">
        <h1>Transaction processing</h1>
        <p>{displayValue(transaction.id)} is still being prepared for review.</p>
        <Link className="btn btn-secondary" to="/transactions">Back to Transactions</Link>
      </div>
    );
  }

  const riskLevel = getRiskLevel(transaction.riskScore) ?? 'Not available';
  const alertRiskLevel = alert
    ? getRiskLevel(alert.riskScore) ?? 'Not available'
    : null;
  const dataQuality = getTransactionDataQuality(transaction);
  const reviewState = alert?.status === 'Reviewed' ? 'Reviewed' : 'Not Reviewed';
  const accountability = createReviewAccountability();
  const timestamp = [transaction.date, transaction.time]
    .filter((value) => value !== null && value !== undefined && String(value).trim())
    .join(' · ');
  const hasVendor = typeof transaction.vendor === 'string' && transaction.vendor.trim();
  const hasVendorId = transaction.vendorId !== null
    && transaction.vendorId !== undefined
    && String(transaction.vendorId).trim();

  const handleMarkReviewed = () => {
    markAlertReviewed(transaction.id);
    showNotification('Transaction marked as reviewed for this session.', 'success');
  };

  return (
    <div className="transaction-detail-page">
      <Link className="detail-back-link" to="/transactions">
        <ArrowLeftIcon width={15} height={15} />
        Back to Transactions
      </Link>

      <header className="transaction-detail-header">
        <div>
          <span className="detail-eyebrow">Transaction</span>
          <div className="transaction-title-row">
            <h1>{displayValue(transaction.id)}</h1>
            <span className={riskBadgeClass(riskLevel)}>{riskLevel}</span>
          </div>
          <p className="transaction-detail-vendor">{hasVendorId ? <Link to={`/vendors/${transaction.vendorId}`}>{displayValue(transaction.vendor)}</Link> : displayValue(transaction.vendor)} <VendorMonitoringIndicator status={transaction.vendorMonitoringStatus} /></p>
        </div>
        {timestamp && <time className="transaction-detail-time">{timestamp}</time>}
      </header>

      <section className="card risk-summary-card" aria-labelledby="risk-summary-heading">
        <div className="card-header">
          <h2 id="risk-summary-heading">Risk Summary</h2>
        </div>
        <div className="risk-summary-grid">
          <div className="risk-summary-primary">
            <span>Final Risk Score</span>
            <strong>{formatScore(transaction.riskScore)}</strong>
          </div>
          <div className="risk-summary-item">
            <span>Risk Level</span>
            <strong className={riskBadgeClass(riskLevel)}>{riskLevel}</strong>
          </div>
          <div className="risk-summary-item">
            <span>Rule Score</span>
            <strong>{formatScore(transaction.ruleScore)}</strong>
          </div>
          <div className="risk-summary-item">
            <span>AI Score</span>
            <strong>{formatScore(transaction.aiScore)}</strong>
          </div>
          <div className="risk-summary-item">
            <span>Rule Status</span>
            <strong className={ruleStatusPillClass(transaction.ruleStatus)}>
              {displayValue(transaction.ruleStatus)}
            </strong>
          </div>
        </div>
      </section>

      <section className="card transaction-info-card" aria-labelledby="transaction-info-heading">
        <div className="card-header">
          <h2 id="transaction-info-heading">Transaction Information</h2>
        </div>
        <dl className="transaction-info-grid">
          <DetailField label="Transaction ID" value={transaction.id} />
          <DetailField label="Vendor" value={transaction.vendor} />
          {hasVendorId && <DetailField label="Vendor ID" value={transaction.vendorId} />}
          <DetailField label="Category" value={transaction.category} />
          <DetailField label="Amount" value={formatAmount(transaction.amount, transaction.currency)} />
          <DetailField label="Currency" value={transaction.currency} />
          <DetailField label="Date" value={transaction.date} />
          <DetailField label="Time" value={transaction.time} />
        </dl>
      </section>

      <section className="card audit-results-card" aria-labelledby="audit-results-heading">
        <div className="card-header">
          <div>
            <h2 id="audit-results-heading">Audit Rule Results</h2>
            <p>Evidence recorded for the five project audit rules.</p>
          </div>
        </div>
        <div className="audit-results-list">
          {AUDIT_RULE_DEFINITIONS.map(({ key, label }) => {
            const result = transaction.rules?.[key];
            const status = displayValue(result?.status);
            const isPassed = status === 'Passed';
            const isFailed = status === 'Failed';

            return (
              <article
                className={`audit-result${isFailed ? ' audit-result-failed' : ''}`}
                key={key}
              >
                <span
                  className={`audit-result-icon ${isPassed ? 'is-passed' : isFailed ? 'is-failed' : 'is-unknown'}`}
                  aria-hidden="true"
                >
                  {isPassed ? '✓' : isFailed ? '!' : '—'}
                </span>
                <div className="audit-result-content">
                  <h3>{label}</h3>
                  <p>{displayValue(result?.detail)}</p>
                </div>
                <span className={`rule-tag ${isFailed ? 'tag-failed' : isPassed ? 'tag-passed' : 'tag-unknown'}`}>
                  {status}
                </span>
              </article>
            );
          })}
        </div>
      </section>

      <div className="transaction-analysis-grid">
        <section className="card analysis-card" aria-labelledby="ai-analysis-heading">
          <div className="card-header">
            <h2 id="ai-analysis-heading">AI Analysis</h2>
          </div>
          <div className="analysis-card-body">
            <div className="analysis-score-row">
              <span>AI Score</span>
              <strong>{formatScore(transaction.aiScore)}</strong>
            </div>
            <span className="analysis-status">{displayValue(transaction.aiStatus)}</span>
            <p>{displayValue(transaction.aiExplanation)}</p>
          </div>
        </section>

        <section className="card analysis-card" aria-labelledby="risk-explanation-heading">
          <div className="card-header">
            <h2 id="risk-explanation-heading">Risk Explanation</h2>
          </div>
          <div className="analysis-card-body">
            <p>{displayValue(transaction.riskExplanation)}</p>
          </div>
        </section>
      </div>

      <section className="card data-quality-card" aria-labelledby="data-quality-heading">
        <div>
          <span className="detail-section-label" id="data-quality-heading">Data Quality</span>
          <strong className={`data-quality-status quality-${dataQuality.status.toLowerCase().replaceAll(' ', '-')}`}>
            {dataQuality.status}
          </strong>
        </div>
        <p>
          {dataQuality.missingFields.length > 0
            ? `Missing fields: ${dataQuality.missingFields.join(', ')}.`
            : 'All fields required for this review are available.'}
        </p>
      </section>

      <div className={`transaction-review-grid${alert ? '' : ' without-alert'}`}>
        <section className="card review-state-card" aria-labelledby="review-state-heading">
          <div className="card-header">
            <div>
              <h2 id="review-state-heading">Review &amp; Accountability</h2>
              <p>Session status and future authoritative review history.</p>
            </div>
          </div>
          <div className="review-accountability-body">
            <section className="session-review-section" aria-labelledby="session-review-heading">
              <span className="review-section-label">Review Status</span>
              <h3 id="session-review-heading">Current Session Review Status</h3>
              <div className="review-state-row">
                <span>Current Status</span>
                <strong className={reviewState === 'Reviewed' ? 'reviewed-state' : 'not-reviewed-state'}>{reviewState}</strong>
              </div>
              <p>Review status is currently maintained for this session and does not create an attributed history record.</p>
              <div className="review-actions">
                {alert && (
                  <button className="btn btn-primary" type="button" onClick={handleMarkReviewed} disabled={reviewState === 'Reviewed'}>
                    {reviewState === 'Reviewed' ? 'Reviewed' : 'Mark as Reviewed'}
                  </button>
                )}
                {hasVendor && (
                  <Link className="btn btn-secondary" to={`/transactions?vendor=${encodeURIComponent(transaction.vendor)}`}>
                    View Related Transactions
                  </Link>
                )}
              </div>
            </section>

            <section className="review-accountability-section" aria-labelledby="accountability-heading">
              <h3 id="accountability-heading">Accountability</h3>
              <dl>
                <div><dt>Reviewed By</dt><dd>{accountability.reviewedBy ?? <span aria-label="Unavailable">—</span>}</dd></div>
                <div><dt>Reviewed At</dt><dd>{accountability.reviewedAt ?? <span aria-label="Unavailable">—</span>}</dd></div>
              </dl>
            </section>

            <section className="review-note-section" aria-labelledby="review-note-heading">
              <div>
                <h3 id="review-note-heading">Review Note</h3>
                <p>{accountability.note ?? 'No review note available.'}</p>
              </div>
              <button className="btn btn-secondary" type="button" disabled title="Review notes are not available yet.">Add Review Note</button>
            </section>

            <section className="review-history-section" aria-labelledby="review-history-heading">
              <h3 id="review-history-heading">Review History</h3>
              <ReviewHistory records={accountability.history} />
            </section>
            <section className="review-resolution-section" aria-labelledby="review-resolution-heading">
              <div><h3 id="review-resolution-heading">Review Resolution</h3><p>Record an authoritative outcome separately from the current session review status.</p></div>
              <label><span>Outcome</span><select disabled defaultValue=""><option value="">Select an outcome</option>{Object.values(REVIEW_RESOLUTIONS).map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
              <label><span>Resolution Note</span><textarea rows="3" disabled placeholder="Add supporting context" /></label>
              <button type="button" className="btn btn-secondary" disabled title="Review resolution is not available until the service is connected.">Save Resolution</button>
            </section>
          </div>
        </section>

        {alert && (
          <section className="card related-alert-card" aria-labelledby="related-alert-heading">
            <div className="card-header">
              <h2 id="related-alert-heading">Related Alert</h2>
            </div>
            <dl className="related-alert-list">
              <DetailField label="Alert Type" value={alert.title} />
              <DetailField label="Risk Level" value={alertRiskLevel} />
              <DetailField label="Time" value={alert.time} />
              <DetailField label="Review State" value={reviewState} />
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}
