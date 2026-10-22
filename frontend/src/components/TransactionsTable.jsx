import DateTime from './DateTime.jsx';
import { DISPLAY_TIME_ZONE_LABEL } from '../utils/dateTime.js';
import { Link, useNavigate } from 'react-router-dom';
import {
  displayValue,
  formatAmount,
  formatScore,
  ruleStatusPillClass,
  riskStatusPillClass,
} from './statusUtils';
import { getTransactionRiskLevel } from '../utils/risk';
import VendorMonitoringIndicator from './VendorMonitoringIndicator.jsx';

export default function TransactionsTable({ transactions, highlightId }) {
  const navigate = useNavigate();

  return <TransactionsTableView transactions={transactions} highlightId={highlightId} onOpenTransaction={(id) => navigate(`/transactions/${id}`)} />;
}

export function TransactionsTableView({ transactions, highlightId, onOpenTransaction: openTransaction }) {

  const handleRowKeyDown = (event, id) => {
    if (event.target !== event.currentTarget || event.defaultPrevented) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openTransaction(id);
    }
  };

  return (
    <div className="transactions-table-wrap">
      <table className="data-table transactions-table">
        <thead>
          <tr>
            <th>Transaction ID</th>
            <th>Vendor</th>
            <th>Category</th>
            <th>Amount</th>
            <th>Time ({DISPLAY_TIME_ZONE_LABEL})</th>
            <th>Rule Status</th>
            <th>AI Score</th>
            <th>Risk Score</th>
            <th>Risk Level</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => {
            const riskLevel = getTransactionRiskLevel(transaction) ?? 'Not available';
            const transactionId = displayValue(transaction?.id);
            const vendor = displayValue(transaction?.vendor);
            const canOpenTransaction = typeof transaction?.id === 'string'
              && transaction.id.trim().length > 0;

            return (
              <tr
                key={transaction?.id ?? `${vendor}-${transaction?.timestamp}`}
                className={`${canOpenTransaction ? 'clickable' : ''}${transaction?.id === highlightId ? ' row-new' : ''}`}
                role={canOpenTransaction ? 'link' : undefined}
                tabIndex={canOpenTransaction ? 0 : undefined}
                aria-label={canOpenTransaction
                  ? `View transaction ${transactionId}, ${riskLevel}`
                  : undefined}
                onClick={() => canOpenTransaction && openTransaction(transaction.id)}
                onKeyDown={(event) => (
                  canOpenTransaction && handleRowKeyDown(event, transaction.id)
                )}
              >
                <td data-label="Transaction ID">{transactionId}</td>
                <td className="vendor-cell" data-label="Vendor" title={vendor}><span className="vendor-cell-content">{transaction?.vendorId ? <Link to={`/vendors/${transaction.vendorId}`} onClick={(event) => event.stopPropagation()}>{vendor}</Link> : vendor}<VendorMonitoringIndicator status={transaction?.vendorMonitoringStatus} /></span></td>
                <td data-label="Category">{displayValue(transaction?.category)}</td>
                <td data-label="Amount">{formatAmount(transaction?.amount, transaction?.currency)}</td>
                <td data-label={`Time (${DISPLAY_TIME_ZONE_LABEL})`}><DateTime value={transaction?.timestamp} compact showZone={false} /></td>
                <td data-label="Rule Status">
                  <span className={ruleStatusPillClass(transaction?.ruleStatus)}>
                    {displayValue(transaction?.ruleStatus)}
                  </span>
                </td>
                <td data-label="AI Score">{formatScore(transaction?.aiScore)}</td>
                <td data-label="Risk Score">{formatScore(transaction?.riskScore)}</td>
                <td data-label="Risk Level">
                  <span className={riskStatusPillClass(riskLevel)}>{riskLevel}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
