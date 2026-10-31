import { useNavigate } from 'react-router-dom';
import { formatAmount, riskStatusPillClass } from './statusUtils';
import { getTransactionRiskLevel } from '../utils/risk';
import { ChevronRightIcon } from './icons.jsx';

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
    <div className="table-wrap">
      <table className="data-table recent-transactions-table">
        <thead>
          <tr>
            <th>Transaction</th><th>Vendor</th><th>Amount</th><th>Risk</th><th><span className="sr-only">Open</span></th>
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
                <td data-label="Transaction"><span className="reference-text truncate" title={transaction.id}>{transaction.id}</span></td>
                <td data-label="Vendor"><span className="truncate" title={transaction.vendor}>{transaction.vendor}</span></td>
                <td data-label="Amount" className="numeric">{formatAmount(transaction.amount, transaction.currency)}</td>
                <td data-label="Risk"><span className={riskStatusPillClass(riskLevel)}>{riskLevel}</span></td>
                <td data-label="" className="cell-actions"><span className="row-chevron" aria-hidden="true"><ChevronRightIcon /></span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
