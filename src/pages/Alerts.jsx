import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { DuplicateIcon, LimitIcon, SplitIcon, GhostIcon, UsersIcon } from '../components/icons';

function iconFor(title) {
  if (title.includes('Duplicate')) return { Icon: DuplicateIcon, bg: '#fdecec', color: '#dc2626' };
  if (title.includes('Approval')) return { Icon: LimitIcon, bg: '#fdf1e2', color: '#ea8c1e' };
  if (title.includes('Splitting')) return { Icon: SplitIcon, bg: '#fdf1e2', color: '#ea8c1e' };
  if (title.includes('Ghost')) return { Icon: GhostIcon, bg: '#fdecec', color: '#dc2626' };
  if (title.includes('Segregation')) return { Icon: UsersIcon, bg: '#fdf1e2', color: '#ea8c1e' };
  return { Icon: LimitIcon, bg: '#fdf1e2', color: '#ea8c1e' };
}

export default function Alerts() {
  const { alerts } = useApp();
  const navigate = useNavigate();

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Alerts</h1>
          <p>All audit rule violations and anomaly alerts.</p>
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
                const { Icon, bg, color } = iconFor(alert.title);
                return (
                  <tr
                    key={alert.id}
                    className="clickable"
                    onClick={() => navigate(`/transactions/${alert.transactionId}`)}
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
