import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="card not-found-card">
      <div className="not-found-code">404</div>
      <h1>Page Not Found</h1>
      <p>The page you requested does not exist in this frontend demo.</p>
      <Link className="btn btn-primary" to="/">
        Return to Dashboard
      </Link>
    </div>
  );
}
