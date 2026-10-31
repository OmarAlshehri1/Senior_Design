import { shortReference, transactionReference } from '../utils/presentation.js';
import Reference from './Reference.jsx';
import TransactionReference from './TransactionReference.jsx';
import DateTime from './DateTime.jsx';
import { useNavigate } from 'react-router-dom';
import { displayValue, riskStatusPillClass } from './statusUtils';
import { getAlertRiskLevel, getAlertRuleLabels } from '../utils/alerts';
import { ActionMenu } from './ui/Overlays.jsx';

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
    <div className="table-wrap">
      <table className="data-table alerts-table">
        <thead><tr><th>Alert</th><th>Transaction</th><th>Risk</th><th>Status</th><th>Assigned to</th><th>Raised</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {alerts.map((alert) => {
            const riskLevel = getAlertRiskLevel(alert) ?? 'Not available';
            const canOpenTransaction = typeof alert?.transactionId === 'string'
              && alert.transactionId.trim().length > 0;
            const isReviewed = alert?.status === 'Reviewed';
            const statusLabel = isReviewed ? 'Reviewed' : alert?.status === 'Active' ? 'Active' : 'Unavailable';
            const ruleLabels = getAlertRuleLabels(alert?.ruleKeys);

            return (
              <tr
                key={alert?.id ?? `${alert?.transactionId}-${alert?.timestamp}`}
                className={canOpenTransaction ? 'clickable' : undefined}
                role={canOpenTransaction ? 'link' : undefined}
                tabIndex={canOpenTransaction ? 0 : undefined}
                aria-label={canOpenTransaction
                  ? `View transaction ${transactionReference(alert.transactionId)} for ${displayValue(alert?.title)}`
                  : undefined}
                onClick={() => canOpenTransaction && openTransaction(alert.transactionId, alert)}
                onKeyDown={(event) => (
                  canOpenTransaction && handleRowKeyDown(event, alert.transactionId, alert)
                )}
              >
                <td data-label="Alert" className="alert-cell">
                  {ruleLabels.length
                    ? <span className="cell-primary alert-rules" title={displayValue(alert?.title)}>{ruleLabels.join(' · ')}</span>
                    : <span className="cell-primary">{displayValue(alert?.title)}</span>}
                  <Reference value={alert?.id} />
                </td>
                <td data-label="Transaction"><span className="cell-primary truncate" title={alert?.vendor}>{displayValue(alert?.vendor, '—')}</span><span className="secondary-metadata"><TransactionReference value={alert?.transactionId} /></span></td>
                <td data-label="Risk"><span className={riskStatusPillClass(riskLevel)}>{riskLevel}</span>{Number.isFinite(alert?.riskScore) && <span className="secondary-metadata">Score {alert.riskScore}</span>}</td>
                <td data-label="Status"><span className={`badge ${isReviewed ? 'badge-low' : statusLabel === 'Active' ? 'badge-info' : 'badge-neutral'}`}>{statusLabel}</span></td>
                <td data-label="Assigned to">{alert.assignment?.assigneeName ?? <span className="muted">Unassigned</span>}</td>
                <td data-label="Raised"><DateTime value={alert?.timestamp} compact /></td>
                <td className="cell-actions" data-label="Actions">
                  <div className="row-actions">
                    {!isReviewed && canOpenTransaction && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm" disabled={reviewing} aria-busy={reviewing}
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
                    <ActionMenu label={`More actions for alert ${shortReference(alert?.id)}`} items={[
                      canOpenTransaction && { label: 'View transaction', onSelect: () => openTransaction(alert.transactionId, alert) },
                      canAssign && { label: alert.assignment?.assigneeName ? 'Reassign' : 'Assign', onSelect: () => onAssign?.(alert) },
                      canEscalateToCase && { label: 'Create case', onSelect: () => onCreateCase?.(alert) },
                    ]} />
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
