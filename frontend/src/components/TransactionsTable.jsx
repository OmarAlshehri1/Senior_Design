import DateTime from './DateTime.jsx';
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
      <table className="data-table transactions-table task-transactions-table">
        <thead>
          <tr>
            <th>Transaction</th><th>Vendor</th><th>Amount</th><th>Risk</th><th>Status</th><th>Time</th><th>Scores</th>
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
                <td data-label="Transaction"><span className="transaction-reference" title={transactionId}>{transactionId}</span><span className="secondary-metadata">{displayValue(transaction?.category)}</span></td>
                <td className="vendor-cell" data-label="Vendor" title={vendor}><span className="vendor-cell-content">{transaction?.vendorId ? <Link to={`/vendors/${transaction.vendorId}`} onClick={(event) => event.stopPropagation()}>{vendor}</Link> : vendor}<VendorMonitoringIndicator status={transaction?.vendorMonitoringStatus} /></span></td>
                <td data-label="Amount">{formatAmount(transaction?.amount, transaction?.currency)}</td>
                <td data-label="Risk"><span className={riskStatusPillClass(riskLevel)}>{riskLevel}</span></td>
                <td data-label="Status"><span className={ruleStatusPillClass(transaction?.ruleStatus)}>{displayValue(transaction?.ruleStatus)}</span></td>
                <td data-label="Time"><DateTime value={transaction?.timestamp} compact /></td>
                <td data-label="Scores"><span className="secondary-metadata">AI {formatScore(transaction?.aiScore)}</span><span className="secondary-metadata">Risk {formatScore(transaction?.riskScore)}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
