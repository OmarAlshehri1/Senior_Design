import { useNavigate } from 'react-router-dom';
import { formatSAR, ruleStatusPillClass, riskStatusPillClass } from './statusUtils';
import { getRiskLevel } from '../utils/risk';

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
      <table className="data-table dashboard-transactions-table">
        <thead>
          <tr>
            <th>Transaction ID</th>
            <th>Vendor</th>
            <th>Amount</th>
            <th>Rule Status</th>
            <th>AI Score</th>
            <th>Risk Score</th>
            <th>Risk Level</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => {
            const riskLevel = getRiskLevel(transaction.riskScore) ?? 'Processing';

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
                <td data-label="Transaction ID">{transaction.id}</td>
                <td className="vendor-cell" data-label="Vendor" title={transaction.vendor}>
                  {transaction.vendor}
                </td>
                <td data-label="Amount">{formatSAR(transaction.amount)}</td>
                <td data-label="Rule Status">
                  <span className={ruleStatusPillClass(transaction.ruleStatus)}>
                    {transaction.ruleStatus}
                  </span>
                </td>
                <td data-label="AI Score">{transaction.aiScore ?? '—'}</td>
                <td data-label="Risk Score">
                  {Number.isFinite(transaction.riskScore) ? `${transaction.riskScore}/100` : '—'}
                </td>
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
