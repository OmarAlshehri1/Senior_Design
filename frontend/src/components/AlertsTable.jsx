import { shortReference } from '../utils/presentation.js';
import Reference from './Reference.jsx';
import DateTime from './DateTime.jsx';
import { useNavigate } from 'react-router-dom';
import { getAlertPresentation } from './alertUtils';
import {
  displayValue,
  formatScore,
  riskStatusPillClass,
} from './statusUtils';
import { getAlertRiskLevel } from '../utils/alerts';

export default function AlertsTable({ alerts, alertOwnerId, onMarkReviewed, reviewing = false, canAssign = false, onAssign, canEscalateToCase = false, onCreateCase }) {
  const navigate = useNavigate();

  const openTransaction = (transactionId, alert) => navigate(`/transactions/${transactionId}`, { state: { alert, alertOwnerId } });

  const handleRowKeyDown = (event, transactionId, alert) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openTransaction(transactionId, alert);
    }
  };

  return (
    <div className="alerts-table-wrap">
      <table className="data-table alerts-table task-alerts-table">
        <thead><tr><th>Alert</th><th>Transaction</th><th>Risk</th><th>Status</th><th>Assigned to</th><th>Time</th><th>Actions</th></tr></thead>
        <tbody>
          {alerts.map((alert) => {
            const { Icon, bg, color } = getAlertPresentation(alert?.title ?? '');
            const riskLevel = getAlertRiskLevel(alert) ?? 'Not available';
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
                onClick={() => canOpenTransaction && openTransaction(alert.transactionId, alert)}
                onKeyDown={(event) => (
                  canOpenTransaction && handleRowKeyDown(event, alert.transactionId, alert)
                )}
              >
                <td className="alert-type-table-cell" data-label="Alert">
                  <div className="alert-type-cell-content"><span className="alert-table-icon" style={{ background: bg, color }} aria-hidden="true"><Icon width={15} height={15} /></span>
                    <div className="alert-type-copy"><strong>{displayValue(alert?.title)}</strong><span>{displayValue(alert?.reasonText, '')}</span><Reference value={alert?.id} /></div>
                  </div>
                </td>
                <td data-label="Transaction"><span>{displayValue(alert?.vendor, '—')}</span><span className="secondary-metadata" title={alert?.transactionId}>{shortReference(alert?.transactionId)}</span></td>
                <td data-label="Risk"><span className={riskStatusPillClass(riskLevel)}>{riskLevel}</span><span className="secondary-metadata">Score {formatScore(alert?.riskScore)}</span></td>
                <td data-label="Status"><span className={`alert-review-badge ${isReviewed ? 'is-reviewed' : 'is-active'}`}>{isReviewed ? 'Reviewed' : alert?.status === 'Active' ? 'Active' : 'Unavailable'}</span></td>
                <td data-label="Assigned to">{alert.assignment?.assigneeName ?? '—'}</td>
                <td data-label="Time"><DateTime value={alert?.timestamp} compact /></td>
                <td className="alert-actions-cell" data-label="Actions">
                  <div className="alert-actions">
                    {canEscalateToCase && (
                      <button type="button" className="btn btn-secondary alert-case-button" onClick={(event) => { event.stopPropagation(); onCreateCase?.(alert); }} onKeyDown={(event) => event.stopPropagation()}>
                        Create Case
                      </button>
                    )}
                    {canAssign && (
                      <button
                        type="button"
                        className="btn btn-secondary alert-assign-button"
                        aria-label={`Assign alert ${displayValue(alert?.id)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAssign?.(alert);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        Assign
                      </button>
                    )}
                    {!isReviewed && canOpenTransaction && (
                      <button
                        type="button"
                        className="btn btn-secondary alert-review-button" disabled={reviewing} aria-busy={reviewing}
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
                          openTransaction(alert.transactionId, alert);
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
