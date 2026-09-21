import { useNavigate } from 'react-router-dom';
import { getAlertPresentation } from './alertUtils';
import {
  displayValue,
  formatScore,
  riskStatusPillClass,
} from './statusUtils';
import { getRiskLevel } from '../utils/risk';

export default function AlertsTable({ alerts, onMarkReviewed }) {
  const navigate = useNavigate();

  const openTransaction = (transactionId) => navigate(`/transactions/${transactionId}`);

  const handleRowKeyDown = (event, transactionId) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openTransaction(transactionId);
    }
  };

  return (
    <div className="alerts-table-wrap">
      <table className="data-table alerts-table">
        <colgroup>
          <col className="alert-column-id" />
          <col className="alert-column-transaction" />
          <col className="alert-column-vendor" />
          <col className="alert-column-type" />
          <col className="alert-column-time" />
          <col className="alert-column-score" />
          <col className="alert-column-risk" />
          <col className="alert-column-status" />
          <col className="alert-column-actions" />
        </colgroup>
        <thead>
          <tr>
            <th>Alert ID</th>
            <th>Transaction ID</th>
            <th>Vendor</th>
            <th>Alert Type</th>
            <th>Time</th>
            <th>Risk Score</th>
            <th>Risk Level</th>
            <th>Review Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => {
            const { Icon, bg, color } = getAlertPresentation(alert?.title ?? '');
            const riskLevel = getRiskLevel(alert?.riskScore) ?? 'Not available';
            const canOpenTransaction = typeof alert?.transactionId === 'string'
              && alert.transactionId.trim().length > 0;
            const isReviewed = alert?.status === 'Reviewed';

            return (
              <tr
                key={alert?.id ?? `${alert?.transactionId}-${alert?.timestamp}`}
                className={canOpenTransaction ? 'clickable' : undefined}
                role={canOpenTransaction ? 'link' : undefined}
                tabIndex={canOpenTransaction ? 0 : undefined}
                aria-label={canOpenTransaction
                  ? `View transaction ${alert.transactionId} for ${displayValue(alert?.title)}`
                  : undefined}
                onClick={() => canOpenTransaction && openTransaction(alert.transactionId)}
                onKeyDown={(event) => (
                  canOpenTransaction && handleRowKeyDown(event, alert.transactionId)
                )}
              >
                <td data-label="Alert ID">{displayValue(alert?.id)}</td>
                <td data-label="Transaction ID">{displayValue(alert?.transactionId)}</td>
                <td className="vendor-cell" data-label="Vendor" title={displayValue(alert?.vendor)}>
                  {displayValue(alert?.vendor)}
                </td>
                <td className="alert-type-table-cell" data-label="Alert Type">
                  <span className="alert-table-icon" style={{ background: bg, color }} aria-hidden="true">
                    <Icon width={15} height={15} />
                  </span>
                  <span className="alert-type-copy">
                    <strong>{displayValue(alert?.title)}</strong>
                    <span>{displayValue(alert?.reasonText)}</span>
                  </span>
                </td>
                <td data-label="Time">{displayValue(alert?.time)}</td>
                <td data-label="Risk Score">{formatScore(alert?.riskScore)}</td>
                <td data-label="Risk Level">
                  <span className={riskStatusPillClass(riskLevel)}>{riskLevel}</span>
                </td>
                <td data-label="Review Status">
                  <span className={`alert-review-badge ${isReviewed ? 'is-reviewed' : 'is-active'}`}>
                    {isReviewed ? 'Reviewed' : 'Active'}
                  </span>
                </td>
                <td className="alert-actions-cell" data-label="Actions">
                  <div className="alert-actions">
                    {!isReviewed && canOpenTransaction && (
                      <button
                        type="button"
                        className="btn btn-secondary alert-review-button"
                        aria-label={`Mark alert ${displayValue(alert?.id)} as reviewed`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onMarkReviewed(alert.transactionId);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        Mark Reviewed
                      </button>
                    )}
                    {canOpenTransaction && (
                      <button
                        type="button"
                        className="alert-view-transaction"
                        aria-label={`View transaction ${alert.transactionId}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openTransaction(alert.transactionId);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        View
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
