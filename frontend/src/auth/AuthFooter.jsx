import { Link } from 'react-router-dom';
import { AUTH_ROUTES } from './authRoutes.js';

export default function AuthFooter({ hideSupport = false }) {
  return (
    <footer className="auth-footer" aria-label="Account assistance">
      {!hideSupport && <Link to={AUTH_ROUTES.SUPPORT}>Contact Support</Link>}
      {!hideSupport && <span aria-hidden="true">·</span>}
      <Link to={AUTH_ROUTES.PRIVACY_SECURITY}>Privacy &amp; Security</Link>
    </footer>
  );
}
