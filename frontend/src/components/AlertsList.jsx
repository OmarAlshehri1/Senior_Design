import { useNavigate } from 'react-router-dom';
import { getAlertPresentation } from './alertUtils';

export default function AlertsList({ alerts }) {
  const navigate = useNavigate();

  return (
    <div className="alert-list">
      {alerts.map((alert) => {
        const { Icon, bg, color } = getAlertPresentation(alert.title);
        return (
          <button
            type="button"
            key={alert.id}
            className="alert-item"
            aria-label={`View ${alert.title} for transaction ${alert.transactionId}`}
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
          </button>
        );
      })}
    </div>
  );
}
