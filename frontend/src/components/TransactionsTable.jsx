import { useNavigate } from 'react-router-dom';
import {
  displayValue,
  formatSAR,
  formatScore,
  ruleStatusPillClass,
  riskStatusPillClass,
} from './statusUtils';
import { getRiskLevel } from '../utils/risk';

export default function TransactionsTable({ transactions, highlightId }) {
  const navigate = useNavigate();

  const openTransaction = (id) => navigate(`/transactions/${id}`);

  const handleRowKeyDown = (event, id) => {
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
            <th>Time</th>
            <th>Rule Status</th>
            <th>AI Score</th>
            <th>Risk Score</th>
            <th>Risk Level</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => {
            const riskLevel = getRiskLevel(transaction?.riskScore) ?? 'Not available';
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
                <td className="vendor-cell" data-label="Vendor" title={vendor}>{vendor}</td>
                <td data-label="Category">{displayValue(transaction?.category)}</td>
                <td data-label="Amount">{formatSAR(transaction?.amount)}</td>
                <td data-label="Time">{displayValue(transaction?.time)}</td>
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
