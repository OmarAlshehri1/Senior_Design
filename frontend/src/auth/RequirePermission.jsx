import { Navigate, useLocation } from 'react-router-dom';
import { APPLICATION_ROUTES } from './routeAccess.js';
import { AUTH_ROUTES } from './authRoutes.js';
import useAuthorization from './useAuthorization.js';

// This boundary controls frontend presentation only. The backend remains the
// authoritative enforcement layer when real identity integration is enabled.
export default function RequirePermission({ permission, children }) {
  const { can, isLoading, mode, authenticationRequired } = useAuthorization();
  const location = useLocation();

  if (isLoading) return null;

  if (mode === 'UNCONNECTED' && authenticationRequired) {
    return <Navigate to={AUTH_ROUTES.LOGIN} replace state={{ from: location.pathname }} />;
  }

  if (!can(permission)) {
    return <Navigate to={APPLICATION_ROUTES.FORBIDDEN} replace state={{ from: location.pathname }} />;
  }

  return children;
}
