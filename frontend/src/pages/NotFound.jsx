import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="page status-page">
      <div className="panel status-card">
        <div className="status-code" aria-hidden="true">404</div>
        <h1>Page Not Found</h1>
        <p>The page you requested does not exist or has moved.</p>
        <div className="status-actions">
          <Link className="btn btn-primary" to="/">
            Return to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
