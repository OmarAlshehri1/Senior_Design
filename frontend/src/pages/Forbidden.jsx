import { useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import useAuthorization from '../auth/useAuthorization.js';
import { AUTHORIZATION_MODES } from '../auth/AuthorizationProvider.jsx';
import { APPLICATION_ROUTES } from '../auth/routeAccess.js';
import { getRoleDefinition } from '../auth/roles.js';

export default function Forbidden() {
  const headingRef = useRef(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { mode, effectiveRole } = useAuthorization();
  const previewRole = mode === AUTHORIZATION_MODES.ROLE_PREVIEW
    ? getRoleDefinition(effectiveRole)
    : null;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="page status-page">
      <div className="panel status-card">
        <div className="status-code" aria-hidden="true">403</div>
        <p className="page-eyebrow">Authorization required</p>
        <h1 ref={headingRef} tabIndex="-1">Access Denied</h1>
        <p>Your role does not include access to this area. Ask an administrator if you need it.</p>
        {previewRole && (
          <span className={`forbidden-preview role-badge role-${previewRole.key.toLowerCase()}`}>
            Role Preview: {previewRole.displayName}
          </span>
        )}
        <div className="status-actions">
          <Link className="btn btn-primary" to={APPLICATION_ROUTES.DASHBOARD}>Return to Dashboard</Link>
          {location.state?.from && (
            <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
          )}
        </div>
      </div>
    </div>
  );
}
