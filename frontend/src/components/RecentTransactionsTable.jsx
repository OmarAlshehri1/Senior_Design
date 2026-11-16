import { useNavigate } from 'react-router-dom';
import { formatAmount, riskStatusPillClass } from './statusUtils';
import { getTransactionRiskLevel } from '../utils/risk';
import { ChevronRightIcon } from './icons.jsx';
import TransactionReference from './TransactionReference.jsx';
import { transactionReference } from '../utils/presentation.js';

export default function RecentTransactionsTable({ transactions, highlightId, temporaryTransactions = [] }) {
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
            <th>Transaction</th><th>Vendor</th><th>Category</th><th>Amount</th><th>Risk</th><th><span className="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {[...temporaryTransactions, ...transactions].map((transaction, index) => {
            const isTemporary = index < temporaryTransactions.length;
            const riskLevel = getTransactionRiskLevel(transaction) ?? (transaction.processing ? 'Processing' : 'Not available');

            return (
              <tr
                key={isTemporary ? `temporary:${transaction.id}` : transaction.id}
                className={isTemporary ? `dashboard-temporary-row${index === 0 ? ' row-enter' : ''}` : `clickable${transaction.id === highlightId ? ' row-new' : ''}`}
                role={isTemporary ? undefined : 'link'}
                tabIndex={isTemporary ? undefined : 0}
                aria-label={`${isTemporary ? 'Transaction' : 'View transaction'} ${transactionReference(transaction.id)}, ${riskLevel}`}
                onClick={isTemporary ? undefined : () => openTransaction(transaction.id)}
                onKeyDown={isTemporary ? undefined : (event) => handleRowKeyDown(event, transaction.id)}
              >
                <td data-label="Transaction"><TransactionReference value={transaction.id} /></td>
                <td data-label="Vendor"><span className="truncate" title={transaction.vendor}>{transaction.vendor}</span></td>
                <td data-label="Category">{transaction.category || 'Uncategorized'}</td>
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
