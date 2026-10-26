import { useNavigate } from 'react-router-dom';
import { formatAmount, riskStatusPillClass } from './statusUtils';
import { getTransactionRiskLevel } from '../utils/risk';

export default function RecentTransactionsTable({ transactions, highlightId }) {
  const navigate = useNavigate();

  const openTransaction = (id) => navigate(`/transactions/${id}`);

  const handleRowKeyDown = (event, id) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openTransaction(id);
    }
  };

  return (
    <div className="dashboard-table-wrap">
      <table className="data-table dashboard-transactions-table task-recent-transactions-table">
        <thead>
          <tr>
            <th>Transaction</th><th>Vendor</th><th>Amount</th><th>Risk</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => {
            const riskLevel = getTransactionRiskLevel(transaction) ?? (transaction.processing ? 'Processing' : 'Not available');

            return (
              <tr
                key={transaction.id}
                className={`clickable${transaction.id === highlightId ? ' row-new' : ''}`}
                role="link"
                tabIndex={0}
                aria-label={`View transaction ${transaction.id}, ${riskLevel}`}
                onClick={() => openTransaction(transaction.id)}
                onKeyDown={(event) => handleRowKeyDown(event, transaction.id)}
              >
                <td data-label="Transaction ID"><span className="transaction-reference" title={transaction.id}>{transaction.id}</span></td>
                <td className="vendor-cell" data-label="Vendor" title={transaction.vendor}>
                  {transaction.vendor}
                </td>
                <td data-label="Amount">{formatAmount(transaction.amount, transaction.currency)}</td>
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
