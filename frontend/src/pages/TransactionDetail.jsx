import { useParams, useNavigate, Link } from 'react-router-dom';
import useApp from '../context/useApp';
import { formatSAR, riskBadgeClass } from '../components/statusUtils';
import { ArrowLeftIcon } from '../components/icons';
import { getRiskLevel } from '../utils/risk';

const ruleLabels = {
  duplicatePayment: 'Duplicate Payment',
  approvalLimit: 'Approval Limit',
  invoiceSplitting: 'Invoice Splitting',
  ghostVendor: 'Ghost Vendor',
  segregationOfDuties: 'Segregation of Duties',
};

const ruleOrder = ['duplicatePayment', 'approvalLimit', 'invoiceSplitting', 'ghostVendor', 'segregationOfDuties'];

export default function TransactionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { getTransaction, getAlertForTransaction, markAlertReviewed, showNotification } = useApp();
  const tx = getTransaction(id);
  const alert = getAlertForTransaction(id);

  if (!tx) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center' }}>
        <p>Transaction {id} was not found.</p>
        <Link className="btn btn-secondary" style={{ marginTop: 12 }} to="/transactions">
          Back to Transactions
        </Link>
      </div>
    );
  }

  if (tx.processing) {
    return (
      <div className="card" style={{ padding: 32, textAlign: 'center' }}>
        <p>Transaction {id} is still being processed...</p>
      </div>
    );
  }

  const riskLevel = getRiskLevel(tx.riskScore);

  const handleMarkReviewed = () => {
    markAlertReviewed(tx.id);
    showNotification('Demo alert marked as reviewed for this session.', 'success');
  };

  const handleRelated = () => {
    navigate(`/transactions?vendor=${encodeURIComponent(tx.vendor)}`);
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ marginBottom: 16 }}
        onClick={() => navigate(-1)}
      >
        <ArrowLeftIcon width={15} height={15} />
        Back
      </button>

      <div className="card detail-header-card">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0, fontSize: 19 }}>{tx.id}</h1>
            <span className={riskBadgeClass(riskLevel)}>{riskLevel.toUpperCase()}</span>
          </div>
          <div className="detail-meta">
            <div className="detail-meta-item">
              <div className="label">Vendor</div>
              <div className="value">{tx.vendor}</div>
            </div>
            <div className="detail-meta-item">
              <div className="label">Category</div>
              <div className="value">{tx.category}</div>
            </div>
            <div className="detail-meta-item">
              <div className="label">Amount</div>
              <div className="value">{formatSAR(tx.amount)}</div>
            </div>
            <div className="detail-meta-item">
              <div className="label">Date &amp; Time</div>
              <div className="value">{tx.date}, {tx.time}</div>
            </div>
          </div>
        </div>
        <div className="risk-score-big">
          <div className="cap">Risk Score</div>
          <div className="num">{tx.riskScore}/100</div>
        </div>
      </div>

      <div className="detail-grid">
        <div className="detail-col">
          <div className="card">
            <div className="card-header">
              <h2>Rule Audit Results</h2>
            </div>
            {ruleOrder.map((key) => {
              const rule = tx.rules[key];
              return (
                <div className="rule-row" key={key}>
                  <div>
                    <div className="rule-name">{ruleLabels[key]}</div>
                    <div className="rule-detail">{rule.detail}</div>
                  </div>
                  <span className={`rule-tag ${rule.status === 'Failed' ? 'tag-failed' : 'tag-passed'}`}>
                    {rule.status}
                  </span>
                </div>
              );
            })}
            <div className="section-footer-score">
              <span>Rule Score</span>
              <span>{tx.ruleScore}/100</span>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2>AI Assessment (Demo)</h2>
            </div>
            <div className="ai-block">
              <div className="ai-row">
                <span className="k">AI Status</span>
                <span className="v">{tx.aiStatus}</span>
              </div>
              <div className="ai-row">
                <span className="k">AI Score</span>
                <span className="v">{tx.aiScore}/100</span>
              </div>
              <div>
                <div className="ai-row" style={{ marginBottom: 6 }}>
                  <span className="k">Demo note</span>
                </div>
                <p className="ai-reason">{tx.aiExplanation}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="detail-col">
          <div className="card">
            <div className="card-header">
              <h2>Risk Summary</h2>
            </div>
            <div className="summary-list">
              <div className="summary-list-row">
                <span className="k">Rule Score</span>
                <span className="v">{tx.ruleScore}/100</span>
              </div>
              <div className="summary-list-row">
                <span className="k">AI Score</span>
                <span className="v">{tx.aiScore}/100</span>
              </div>
              <div className="summary-list-row">
                <span className="k">Risk Score</span>
                <span className="v">{tx.riskScore}/100</span>
              </div>
              <div className="summary-list-row">
                <span className="k">Risk Level</span>
                <span className={riskBadgeClass(riskLevel)} style={{ fontSize: 11.5 }}>
                  {riskLevel.toUpperCase()}
                </span>
              </div>
            </div>
          </div>

          {alert && (
            <div className="card">
              <div className="card-header">
                <h2>Alert Information</h2>
              </div>
              <div className="alert-info-block">
                <div className="alert-status-row">
                  <span className="k" style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>
                    Alert Status
                  </span>
                  <span className={alert.status === 'Active' ? 'status-active' : 'status-reviewed'}>
                    {alert.status}
                  </span>
                </div>
                <div className="alert-status-row">
                  <span className="k" style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>
                    Alert Generated
                  </span>
                  <span style={{ fontWeight: 600, fontSize: 13.5 }}>{alert.time}</span>
                </div>
                <div>
                  <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Reason for Flag
                  </div>
                  <p className="alert-reason-text">{alert.reason}</p>
                </div>
              </div>
            </div>
          )}

          <div className="card" style={{ padding: 18 }}>
            <p className="demo-action-note">Review changes are local to this frontend demo.</p>
            <div className="action-buttons">
              <button
                type="button"
                className="btn btn-secondary"
                title="Available after backend integration"
                disabled
              >
                Review Workflow Requires Backend
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleRelated}>
                View Related Transactions
              </button>
              {alert && (
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleMarkReviewed}
                  disabled={alert.status === 'Reviewed'}
                >
                  {alert.status === 'Reviewed' ? 'Reviewed' : 'Mark as Reviewed'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
