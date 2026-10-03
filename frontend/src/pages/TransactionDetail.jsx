import { useEffect, useState } from 'react';
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
import { getRiskLevel, getTransactionRiskLevel } from '../utils/risk';
import { AUDIT_RULE_DEFINITIONS, getTransactionDataQuality } from '../utils/transactions';
import ReviewHistory from '../components/ReviewHistory.jsx';
import { createReviewAccountability } from '../audit/reviewRecords.js';
import { auditService } from '../audit/auditService.js';
import useAuthorization from '../auth/useAuthorization.js';
import { hasPermission, PERMISSIONS } from '../auth/roles.js';
import { REVIEW_RESOLUTIONS } from '../cases/caseWorkflow.js';
import VendorMonitoringIndicator from '../components/VendorMonitoringIndicator.jsx';
import {
  loadTransactionDetail,
  TRANSACTION_DETAIL_STATES,
} from '../services/transactionDetailLoader.js';

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

function DetailLoading() {
  return (
    <div className="card transaction-processing-state" role="status">
      <h1>Loading transaction</h1>
      <p>The transaction detail is being retrieved.</p>
    </div>
  );
}

function DetailError() {
  return (
    <div className="card transaction-not-found" role="alert">
      <span className="transaction-not-found-label">Transaction lookup</span>
      <h1>Transaction detail is unavailable.</h1>
      <p>The transaction could not be retrieved. Try again later.</p>
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
  const { effectiveRole } = useAuthorization();
  const currentTransaction = getTransaction(id);
  const [detailState, setDetailState] = useState(() => ({
    id,
    status: currentTransaction ? TRANSACTION_DETAIL_STATES.SUCCESS : 'loading',
    transaction: currentTransaction,
    error: null,
  }));
  const alert = getAlertForTransaction(id);
  const [reviewHistory, setReviewHistory] = useState([]);
  const [alertReviewHistory, setAlertReviewHistory] = useState([]);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const canReview = hasPermission(effectiveRole, PERMISSIONS.REVIEW_TRANSACTIONS);

  useEffect(() => {
    let active = true;
    auditService.getReviewHistory('TRANSACTION', id).then((result) => {
      if (active) setReviewHistory(result.items ?? []);
    }).catch((error) => {
      if (active) setReviewError(error?.message || 'Review history is unavailable.');
    });
    return () => { active = false; };
  }, [id]);

  useEffect(() => {
    let active = true;
    if (!alert?.id) { setAlertReviewHistory([]); return () => { active = false; }; }
    auditService.getReviewHistory('ALERT', alert.id).then((result) => {
      if (active) setAlertReviewHistory(result.items ?? []);
    }).catch((error) => {
      if (active) setReviewError(error?.message || 'Alert review history is unavailable.');
    });
    return () => { active = false; };
  }, [alert?.id]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    setDetailState({
      id,
      status: currentTransaction ? TRANSACTION_DETAIL_STATES.SUCCESS : 'loading',
      transaction: currentTransaction,
      error: null,
    });

    loadTransactionDetail({
      id,
      currentTransaction,
      signal: controller.signal,
    }).then((result) => {
      if (!active || controller.signal.aborted) return;
      setDetailState({ id, ...result });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [currentTransaction, id]);

  if (detailState.id !== id || detailState.status === 'loading') {
    return <DetailLoading />;
  }

  if (detailState.status === TRANSACTION_DETAIL_STATES.ERROR) {
    return <DetailError />;
  }

  if (detailState.status === TRANSACTION_DETAIL_STATES.NOT_FOUND) {
    return <DetailNotFound id={id} />;
  }

  const transaction = detailState.transaction;

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

  const riskLevel = getTransactionRiskLevel(transaction) ?? 'Not available';
  const alertRiskLevel = alert
    ? getRiskLevel(alert.riskScore) ?? 'Not available'
    : null;
  const dataQuality = getTransactionDataQuality(transaction);
  const accountability = createReviewAccountability(reviewHistory);
  const reviewRecords = [...reviewHistory, ...alertReviewHistory]
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp));
  const reviewState = accountability.reviewedAt ? 'Reviewed' : 'Not Reviewed';
  const alertReviewState = alert?.status === 'Reviewed' ? 'Reviewed' : 'Not Reviewed';
  const timestamp = [transaction.date, transaction.time]
    .filter((value) => value !== null && value !== undefined && String(value).trim())
    .join(' · ');
  const hasVendor = typeof transaction.vendor === 'string' && transaction.vendor.trim();
  const hasVendorId = transaction.vendorId !== null
    && transaction.vendorId !== undefined
    && String(transaction.vendorId).trim();

  const refreshReviewHistory = async () => {
    const result = await auditService.getReviewHistory('TRANSACTION', transaction.id);
    setReviewHistory(result.items ?? []);
  };

  const refreshAlertReviewHistory = async () => {
    if (!alert?.id) return;
    const result = await auditService.getReviewHistory('ALERT', alert.id);
    setAlertReviewHistory(result.items ?? []);
  };

  const handleTransactionReview = async () => {
    setReviewBusy(true);
    setReviewError('');
    try {
      const latestState = reviewHistory.find((record) => ['REVIEWED', 'REOPENED'].includes(record.action));
      const action = latestState?.action === 'REVIEWED' ? 'REOPENED' : 'REVIEWED';
      await auditService.recordReview('TRANSACTION', transaction.id, action);
      await refreshReviewHistory();
      showNotification(action === 'REOPENED' ? 'Transaction review reopened.' : 'Transaction marked as reviewed.', 'success');
    } catch (error) {
      setReviewError(error?.message || 'Transaction review could not be saved.');
    } finally {
      setReviewBusy(false);
    }
  };

  const handleAlertReview = async () => {
    setReviewBusy(true);
    setReviewError('');
    try {
      const nextStatus = alertReviewState === 'Reviewed' ? 'ACTIVE' : 'REVIEWED';
      await markAlertReviewed(transaction.id, nextStatus);
      await refreshAlertReviewHistory();
      showNotification(nextStatus === 'ACTIVE' ? 'Alert review reopened.' : 'Alert marked as reviewed.', 'success');
    } catch (error) {
      setReviewError(error?.message || 'Alert review could not be saved.');
    } finally {
      setReviewBusy(false);
    }
  };

  const handleAddReviewNote = async () => {
    setReviewBusy(true);
    setReviewError('');
    try {
      await auditService.addReviewNote('TRANSACTION', transaction.id, reviewNote);
      setReviewNote('');
      await refreshReviewHistory();
      showNotification('Review note added.', 'success');
    } catch (error) {
      setReviewError(error?.message || 'Review note could not be saved.');
    } finally {
      setReviewBusy(false);
    }
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
            <span className="analysis-status">Isolation Forest</span>
            <p>The anomaly score is supplied by the authoritative backend model.</p>
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
              <p>Review status and attributable history from the audit service.</p>
            </div>
          </div>
          <div className="review-accountability-body">
            <section className="session-review-section" aria-labelledby="session-review-heading">
              <span className="review-section-label">Review Status</span>
              <h3 id="session-review-heading">Transaction Review Status</h3>
              <div className="review-state-row">
                <span>Current Status</span>
                <strong className={reviewState === 'Reviewed' ? 'reviewed-state' : 'not-reviewed-state'}>{reviewState}</strong>
              </div>
              <p>Every review, reopening, and note is saved with the acting user and timestamp.</p>
              <div className="review-actions">
                {canReview && (
                  <button className="btn btn-primary" type="button" onClick={handleTransactionReview} disabled={reviewBusy}>
                    {reviewState === 'Reviewed' ? 'Reopen Transaction Review' : 'Mark Transaction Reviewed'}
                  </button>
                )}
                {alert && canReview && (
                  <button className="btn btn-secondary" type="button" onClick={handleAlertReview} disabled={reviewBusy}>
                    {alertReviewState === 'Reviewed' ? 'Reopen Alert Review' : 'Mark Alert Reviewed'}
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
              <label><span className="sr-only">Review note</span><textarea rows="2" maxLength="2000" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="Add an attributed review note" /></label>
              <button className="btn btn-secondary" type="button" disabled={!canReview || reviewBusy || !reviewNote.trim()} onClick={handleAddReviewNote}>Add Review Note</button>
            </section>

            {reviewError && <p className="integration-error" role="alert">{reviewError}</p>}

            <section className="review-history-section" aria-labelledby="review-history-heading">
              <h3 id="review-history-heading">Review History</h3>
              <ReviewHistory records={reviewRecords} />
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
              <DetailField label="Review State" value={alertReviewState} />
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}
