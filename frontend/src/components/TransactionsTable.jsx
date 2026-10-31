import DateTime from './DateTime.jsx';
import { Link, useNavigate } from 'react-router-dom';
import {
  displayValue,
  formatAmount,
  ruleStatusPillClass,
  riskStatusPillClass,
} from './statusUtils';
import { getTransactionRiskLevel } from '../utils/risk';
import VendorMonitoringIndicator from './VendorMonitoringIndicator.jsx';
import { ChevronRightIcon } from './icons.jsx';

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
    <div className="table-wrap">
      <table className="data-table transactions-table">
        <thead>
          <tr>
            <th>Transaction</th><th>Vendor</th><th>Amount</th><th>Rule status</th><th>Risk</th><th>Time</th><th><span className="sr-only">Open</span></th>
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
                <td data-label="Transaction" className="cell-reference"><span className="reference-text truncate" title={transactionId}>{transactionId}</span>{transaction?.category && <span className="secondary-metadata">{transaction.category}</span>}</td>
                <td data-label="Vendor" title={vendor}><span className="vendor-cell-content">{transaction?.vendorId ? <Link to={`/vendors/${transaction.vendorId}`} onClick={(event) => event.stopPropagation()}>{vendor}</Link> : vendor}<VendorMonitoringIndicator status={transaction?.vendorMonitoringStatus} /></span></td>
                <td data-label="Amount" className="numeric">{formatAmount(transaction?.amount, transaction?.currency)}</td>
                <td data-label="Rule status"><span className={ruleStatusPillClass(transaction?.ruleStatus)}>{displayValue(transaction?.ruleStatus)}</span></td>
                <td data-label="Risk"><span className={riskStatusPillClass(riskLevel)}>{riskLevel}</span>{Number.isFinite(transaction?.riskScore) && <span className="secondary-metadata">Score {transaction.riskScore}</span>}</td>
                <td data-label="Time"><DateTime value={transaction?.timestamp} compact /></td>
                <td data-label="" className="cell-actions">{canOpenTransaction && <span className="row-chevron" aria-hidden="true"><ChevronRightIcon /></span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
