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
    <div className="forbidden-page">
      <div className="forbidden-card">
        <div className="forbidden-code" aria-hidden="true">403</div>
        <p className="forbidden-eyebrow">Authorization required</p>
        <h1 ref={headingRef} tabIndex="-1">Access Denied</h1>
        <p>You do not have permission to access this area.</p>
        <p>Your current role does not include the required permission.</p>
        {previewRole && (
          <span className={`forbidden-preview role-badge role-${previewRole.key.toLowerCase()}`}>
            Role Preview: {previewRole.displayName}
          </span>
        )}
        <div className="forbidden-actions">
          <Link className="btn btn-primary" to={APPLICATION_ROUTES.DASHBOARD}>Return to Dashboard</Link>
          {location.state?.from && (
            <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>Back</button>
          )}
        </div>
      </div>
    </div>
  );
}
