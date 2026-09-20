import { useNavigate } from 'react-router-dom';
import { DuplicateIcon, LimitIcon, SplitIcon } from './icons';

function iconFor(title) {
  if (title.includes('Duplicate')) return { Icon: DuplicateIcon, bg: '#fdecec', color: '#dc2626' };
  if (title.includes('Approval')) return { Icon: LimitIcon, bg: '#fdf1e2', color: '#ea8c1e' };
  if (title.includes('Splitting')) return { Icon: SplitIcon, bg: '#fdf1e2', color: '#ea8c1e' };
  return { Icon: LimitIcon, bg: '#fdf1e2', color: '#ea8c1e' };
}

export default function AlertsList({ alerts }) {
  const navigate = useNavigate();

  return (
    <div className="alert-list">
      {alerts.map((alert) => {
        const { Icon, bg, color } = iconFor(alert.title);
        return (
          <div
            key={alert.id}
            className="alert-item"
            style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/transactions/${alert.transactionId}`)}
          >
            <span className="alert-icon" style={{ background: bg, color }}>
              <Icon />
            </span>
            <div className="alert-body">
              <div className="alert-title-row">
                <span className="alert-title">{alert.title}</span>
                <span className="alert-time">{alert.time}</span>
              </div>
              <div className="alert-desc">{alert.description}</div>
              <span className={`severity-pill severity-${alert.severity}`}>{alert.severity}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
