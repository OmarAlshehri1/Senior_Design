import { useNavigate } from 'react-router-dom';
import { formatSAR, ruleStatusPillClass, riskStatusPillClass } from './statusUtils';

export default function TransactionsTable({ transactions, highlightId }) {
  const navigate = useNavigate();

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
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr
              key={t.id}
              className={`clickable${t.id === highlightId ? ' row-new' : ''}`}
              onClick={() => navigate(`/transactions/${t.id}`)}
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
              <td>{t.riskScore !== null ? `${t.riskScore}/100` : '—'}</td>
              <td>
                <span className={riskStatusPillClass(t.status)}>{t.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
