import { useNavigate } from 'react-router-dom';
import useApp from '../context/useApp';
import { getAlertPresentation } from '../components/alertUtils';

export default function Alerts() {
  const { alerts } = useApp();
  const navigate = useNavigate();

  const openTransaction = (transactionId) => navigate(`/transactions/${transactionId}`);

  const handleRowKeyDown = (event, transactionId) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openTransaction(transactionId);
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Alerts</h1>
          <p>Simulated alerts from the current frontend demo dataset.</p>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Alert</th>
                <th>Transaction ID</th>
                <th>Time</th>
                <th>Risk Score</th>
                <th>Status</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((alert) => {
                const { Icon, bg, color } = getAlertPresentation(alert.title);
                return (
                  <tr
                    key={alert.id}
                    className="clickable"
                    role="link"
                    tabIndex={0}
                    aria-label={`View transaction ${alert.transactionId} for ${alert.title}`}
                    onClick={() => openTransaction(alert.transactionId)}
                    onKeyDown={(event) => handleRowKeyDown(event, alert.transactionId)}
                  >
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 8,
                            background: bg,
                            color,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <Icon width={15} height={15} />
                        </span>
                        <span style={{ fontWeight: 600, whiteSpace: 'normal' }}>{alert.title}</span>
                      </div>
                    </td>
                    <td>{alert.transactionId}</td>
                    <td>{alert.time}</td>
                    <td>{alert.riskScore}/100</td>
                    <td>
                      <span
                        className={alert.status === 'Active' ? 'status-active' : 'status-reviewed'}
                        style={{ fontSize: 13 }}
                      >
                        {alert.status}
                      </span>
                    </td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 320, color: 'var(--text-secondary)' }}>
                      {alert.reason}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
