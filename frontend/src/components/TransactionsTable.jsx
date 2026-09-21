import { useNavigate } from 'react-router-dom';
import { formatSAR, ruleStatusPillClass, riskStatusPillClass } from './statusUtils';
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
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Transaction ID</th>
            <th>Vendor</th>
            <th>Category</th>
            <th>Amount (SAR)</th>
            <th>Time</th>
            <th>Rule Status</th>
            <th>AI Score</th>
            <th>Risk Score</th>
            <th>Risk Level</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => {
            const riskLevel = getRiskLevel(t.riskScore) ?? 'Processing';

            return <tr
              key={t.id}
              className={`clickable${t.id === highlightId ? ' row-new' : ''}`}
              role="link"
              tabIndex={0}
              aria-label={`View transaction ${t.id}`}
              onClick={() => openTransaction(t.id)}
              onKeyDown={(event) => handleRowKeyDown(event, t.id)}
            >
              <td>{t.id}</td>
              <td className="vendor-cell">{t.vendor}</td>
              <td>{t.category}</td>
              <td>{formatSAR(t.amount)}</td>
              <td>{t.time}</td>
              <td>
                <span className={ruleStatusPillClass(t.ruleStatus)}>{t.ruleStatus}</span>
              </td>
              <td>{t.aiScore ?? '—'}</td>
              <td>{Number.isFinite(t.riskScore) ? `${t.riskScore}/100` : '—'}</td>
              <td>
                <span className={riskStatusPillClass(riskLevel)}>{riskLevel}</span>
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}
