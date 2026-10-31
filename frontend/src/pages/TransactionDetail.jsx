import DateTime from '../components/DateTime.jsx';
import { formatDate } from '../utils/dateTime.js';
import { useEffect, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import useApp from '../context/useApp';
import {
  displayValue,
  formatAmount,
  formatScore,
  riskBadgeClass,
  riskTone,
  ruleStatusPillClass,
} from '../components/statusUtils';
import { ArrowLeftIcon, CheckIcon, CopyIcon } from '../components/icons';
import { Badge, KeyValueList, Panel } from '../components/ui/Layout.jsx';
import { ErrorState, LoadingState } from '../components/RequestStateView.jsx';
import { getRiskLevel, getTransactionRiskLevel } from '../utils/risk';
import { AUDIT_RULE_DEFINITIONS, getTransactionDataQuality } from '../utils/transactions';
import ReviewHistory from '../components/ReviewHistory.jsx';
import { createReviewAccountability } from '../audit/reviewRecords.js';
import { auditService } from '../audit/auditService.js';
import useAuthorization from '../auth/useAuthorization.js';
import { hasPermission, PERMISSIONS } from '../auth/roles.js';
import VendorMonitoringIndicator from '../components/VendorMonitoringIndicator.jsx';
import { transactionReference } from '../utils/presentation.js';
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

export function CopyReference({ value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* Selection remains available. */ }
  };
  return <span className="copy-reference">
    <span className="reference-text detail-reference" title={value}>{transactionReference(value)}</span>
    <button type="button" onClick={copy} title={`Copy full transaction ID ${value}`} aria-label={copied ? 'Transaction ID copied' : 'Copy full transaction ID'}>{copied ? <CheckIcon /> : <CopyIcon />}</button>
  </span>;
}

function ScoreBar({ label, score, tone }) {
  const width = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0;
  return <div className="score-bar">
    <div className="score-bar-head"><span>{label}</span><strong>{formatScore(score)}</strong></div>
    <div className="score-bar-track" aria-hidden="true"><div className={`score-bar-fill tone-${tone}`} style={{ width: `${width}%` }} /></div>
  </div>;
}

function DetailNotFound({ id }) {
  return (
    <div className="page detail-state-page">
      <section className="panel">
        <div className="state">
          <p className="state-title">Transaction not found.</p>
          <p className="state-message">No evaluated transaction exists with the ID “{displayValue(id)}”.</p>
          <Link className="btn btn-secondary btn-sm" to="/transactions"><ArrowLeftIcon width={15} height={15} />Back to Transactions</Link>
        </div>
      </section>
    </div>
  );
}

function DetailLoading() {
  return <div className="page detail-state-page"><section className="panel"><LoadingState message="Loading transaction…" /></section></div>;
}

function DetailError() {
  return (
    <div className="page detail-state-page">
      <section className="panel">
        <ErrorState title="Transaction detail is unavailable." message="The transaction could not be retrieved. Try again later." />
        <div className="detail-state-actions"><Link className="btn btn-secondary btn-sm" to="/transactions"><ArrowLeftIcon width={15} height={15} />Back to Transactions</Link></div>
      </section>
    </div>
  );
}

export default function TransactionDetail() {
  const { id } = useParams();
  const { getTransaction, getAlertForTransaction, markAlertReviewed, showNotification } = useApp();
  const { effectiveRole, user } = useAuthorization();
  const currentTransaction = getTransaction(id);
  const [detailState, setDetailState] = useState(() => ({
    id,
    status: currentTransaction ? TRANSACTION_DETAIL_STATES.SUCCESS : 'loading',
    transaction: currentTransaction,
    error: null,
  }));
  const location = useLocation();
  const [linkedAlert, setLinkedAlert] = useState(null);
  const alert = (linkedAlert?.ownerId === user?.id && linkedAlert?.alert?.transactionId === id ? linkedAlert.alert : null) ?? getAlertForTransaction(id) ?? (user?.id && location.state?.alertOwnerId === user.id && location.state?.alert?.transactionId === id ? location.state.alert : null);
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
      <div className="page detail-state-page"><section className="panel"><div className="state" role="status">
        <span className="spinner" aria-hidden="true" />
        <p className="state-title">Transaction processing</p>
        <p className="state-message">{displayValue(transaction.id)} is still being prepared for review.</p>
        <Link className="btn btn-secondary btn-sm" to="/transactions">Back to Transactions</Link>
      </div></section></div>
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
      const reviewed = await markAlertReviewed(transaction.id, nextStatus, null, alert);
      setLinkedAlert({ ownerId: user?.id, alert: reviewed });
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

  const ruleResults = AUDIT_RULE_DEFINITIONS.map(({ key, label }) => ({ key, label, result: transaction.rules?.[key] }));
  const failedRules = ruleResults.filter(({ result }) => result?.status === 'Failed').length;
  const evaluatedRules = ruleResults.filter(({ result }) => ['Passed', 'Failed'].includes(result?.status)).length;
  const tone = riskTone(riskLevel);

  return (
    <div className="page transaction-detail-page">
      <header className="detail-header">
        <Link className="back-link" to="/transactions"><ArrowLeftIcon width={15} height={15} aria-hidden="true" />Transactions</Link>
        <div className="detail-header-main">
          <div className="detail-header-copy">
            <p className="page-eyebrow">Transaction</p>
            <h1 className="sr-only">Transaction {transactionReference(transaction.id)}</h1>
            <div className="detail-title-row">
              <CopyReference value={displayValue(transaction.id)} />
              <span className={riskBadgeClass(riskLevel)}>{riskLevel}</span>
            </div>
            <p className="detail-subtitle">
              {hasVendorId ? <Link to={`/vendors/${transaction.vendorId}`}>{displayValue(transaction.vendor)}</Link> : displayValue(transaction.vendor)}
              <VendorMonitoringIndicator status={transaction.vendorMonitoringStatus} />
              <span aria-hidden="true">·</span>
              <DateTime value={transaction.timestamp} />
            </p>
          </div>
          {canReview && <div className="page-header-actions">
            {alert && <button className="btn btn-secondary" type="button" onClick={handleAlertReview} disabled={reviewBusy}>
              {alertReviewState === 'Reviewed' ? 'Reopen Alert Review' : 'Mark Alert Reviewed'}
            </button>}
            <button className="btn btn-primary" type="button" onClick={handleTransactionReview} disabled={reviewBusy}>
              {reviewState === 'Reviewed' ? 'Reopen Transaction Review' : 'Mark Transaction Reviewed'}
            </button>
          </div>}
        </div>
      </header>

      {transaction.dataset?.active === false && (
        <p className="inline-note" role="note">Archived dataset: {transaction.dataset.label}. This transaction and its review history remain available.</p>
      )}
      {reviewError && <p className="inline-alert" role="alert">{reviewError}</p>}

      <section className="panel detail-summary" aria-labelledby="transaction-info-heading">
        <h2 id="transaction-info-heading" className="sr-only">Transaction Information</h2>
        <dl className="transaction-info-grid">
          <DetailField label="Vendor" value={transaction.vendor} />
          {hasVendorId && <DetailField label="Vendor ID" value={transaction.vendorId} />}
          <DetailField label="Amount" value={formatAmount(transaction.amount, transaction.currency)} />
          <DetailField label="Date" value={formatDate(transaction.timestamp)} />
          <DetailField label="Time" value={<DateTime value={transaction.timestamp} timeOnly />} />
          <DetailField label="Category" value={transaction.category} />
          {transactionReference(transaction.id) !== transaction.id && <DetailField label="Transaction ID" value={<span className="reference-text reference-full-id">{transaction.id}</span>} />}
        </dl>
      </section>

      <div className="detail-layout">
        <div className="detail-main">
          <Panel id="risk-summary-heading" title="Risk assessment" description="Final risk combines rule results (60%) with the anomaly model (40%).">
            <div className="risk-assessment">
              <div className={`risk-score-hero tone-${tone}`}>
                <span>Final risk score</span>
                <strong>{Number.isFinite(transaction.riskScore) ? transaction.riskScore : '—'}<small>/100</small></strong>
                <span className={riskBadgeClass(riskLevel)}>{riskLevel}</span>
              </div>
              <div className="risk-score-breakdown">
                <ScoreBar label="Rule score" score={transaction.ruleScore} tone={transaction.ruleScore > 0 ? 'medium' : 'low'} />
                <ScoreBar label="AI score · Isolation Forest" score={transaction.aiScore} tone={tone === 'neutral' ? 'low' : tone} />
                <div className="score-bar-head"><span>Rule status</span><span className={ruleStatusPillClass(transaction.ruleStatus)}>{displayValue(transaction.ruleStatus)}</span></div>
              </div>
            </div>
            <div className="risk-explanation" aria-labelledby="risk-explanation-heading">
              <h3 id="risk-explanation-heading" className="panel-subtitle">Why this score</h3>
              <p>{displayValue(transaction.riskExplanation, 'No explanation was recorded for this transaction.')}</p>
            </div>
          </Panel>

          <Panel id="audit-results-heading" title="Audit rule results" flush
            description={evaluatedRules ? `${failedRules} of ${evaluatedRules} evaluated rules failed.` : 'No rule results were recorded.'}>
            <ul className="rule-results">
              {ruleResults.map(({ key, label, result }) => {
                const status = displayValue(result?.status);
                const isPassed = status === 'Passed';
                const isFailed = status === 'Failed';
                return (
                  <li className={`rule-result${isFailed ? ' is-failed' : isPassed ? ' is-passed' : ' is-unknown'}`} key={key}>
                    <span className="rule-result-icon" aria-hidden="true">{isPassed ? '✓' : isFailed ? '!' : '–'}</span>
                    <div className="rule-result-copy">
                      <h3>{label}</h3>
                      <p>{displayValue(result?.detail)}</p>
                    </div>
                    <Badge tone={isFailed ? 'high' : isPassed ? 'low' : 'neutral'}>{status}</Badge>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel id="data-quality-heading" title="Data quality"
            actions={<Badge tone={dataQuality.status === 'Complete' ? 'low' : 'medium'}>{dataQuality.status}</Badge>}>
            {dataQuality.missingFields.length > 0
              ? <div className="data-quality-missing"><span>Missing fields</span><ul>{dataQuality.missingFields.map((field) => <li key={field} className="badge badge-outline">{field}</li>)}</ul>
                <p>Rules that need a missing field are recorded as not evaluated rather than passed.</p></div>
              : <p className="muted">All fields required for this review are available.</p>}
          </Panel>
        </div>

        <aside className="detail-side" aria-label="Review">
          <Panel id="review-state-heading" title="Review" actions={<Badge tone={reviewState === 'Reviewed' ? 'low' : 'neutral'}>{reviewState}</Badge>}>
            <KeyValueList items={[
              ['Reviewed by', accountability.reviewedBy ?? '—'],
              ['Reviewed at', <DateTime value={accountability.reviewedAt} />],
            ]} />
            <div className="review-latest-note"><span>Latest note</span><p>{accountability.note ?? 'No review note yet.'}</p></div>
            <div className="review-note-form">
              <label htmlFor="review-note-input" className="field-label">Add a note</label>
              <textarea id="review-note-input" className="input" rows="3" maxLength="2000" value={reviewNote} disabled={!canReview || reviewBusy}
                onChange={(event) => setReviewNote(event.target.value)} placeholder="Notes are saved with your name and time" />
              <button className="btn btn-secondary btn-sm" type="button" disabled={!canReview || reviewBusy || !reviewNote.trim()} onClick={handleAddReviewNote}>Add Review Note</button>
            </div>
            {hasVendor && <Link className="text-link related-link" to={`/transactions?vendor=${encodeURIComponent(transaction.vendor)}`}>View related transactions</Link>}
          </Panel>

          {alert ? (
            <Panel id="related-alert-heading" title="Related alert" actions={<Badge tone={alertReviewState === 'Reviewed' ? 'low' : 'info'}>{alertReviewState}</Badge>}>
              <dl className="key-values columns-1">
                <DetailField label="Alert type" value={alert.title} />
                <DetailField label="Risk level" value={alertRiskLevel} />
                <DetailField label="Raised" value={<DateTime value={alert.timestamp} />} />
              </dl>
            </Panel>
          ) : (
            <Panel id="related-alert-heading" title="Related alert">
              <p className="muted">No alert in your scope is linked to this transaction.</p>
              <Link className="text-link related-link" to="/alerts">Browse alerts</Link>
            </Panel>
          )}

          <Panel id="review-history-heading" title="Review history">
            <ReviewHistory records={reviewRecords} />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
