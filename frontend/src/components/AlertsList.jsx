import DateTime from './DateTime.jsx';
import { useNavigate } from 'react-router-dom';
import { ChevronRightIcon } from './icons.jsx';
import { transactionReference } from '../utils/presentation.js';

const SEVERITY_TONES = Object.freeze({ High: 'high', Medium: 'medium', Low: 'low' });

export default function AlertsList({ alerts, variant = 'default' }) {
  const navigate = useNavigate();

  return (
    <ul className={`alert-list${variant === 'dashboard' ? ' dashboard-alert-list' : ''}`}>
      {alerts.map((alert) => {
        const tone = SEVERITY_TONES[alert.severity] ?? 'neutral';
        return (
          <li key={alert.id}>
            <button
              type="button"
              className="alert-item"
              aria-label={`View ${alert.title} for transaction ${transactionReference(alert.transactionId)}`}
              onClick={() => navigate(`/transactions/${alert.transactionId}`)}
            >
              <span className={`alert-item-marker is-${tone}`} aria-hidden="true" />
              <span className="alert-item-body">
                <span className="alert-item-title">{alert.title}</span>
                <span className="alert-item-description">{alert.description}</span>
              </span>
              <span className="alert-item-meta">
                <span className={`badge badge-${tone} badge-risk`}>{alert.severity ? `${alert.severity} Risk` : 'Risk unavailable'}</span>
                <DateTime value={alert.timestamp} />
              </span>
              <ChevronRightIcon className="alert-item-chevron" width={16} height={16} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
