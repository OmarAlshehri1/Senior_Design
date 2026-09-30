import { Navigate, useLocation } from 'react-router-dom';
import { APPLICATION_ROUTES } from './routeAccess.js';
import useAuthorization from './useAuthorization.js';

// This boundary controls frontend presentation only. The backend remains the
// authoritative enforcement layer when real identity integration is enabled.
export default function RequirePermission({ permission, children }) {
  const { can } = useAuthorization();
  const location = useLocation();

  if (!can(permission)) {
    return <Navigate to={APPLICATION_ROUTES.FORBIDDEN} replace state={{ from: location.pathname }} />;
  }

  return children;
}
