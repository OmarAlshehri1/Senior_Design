import { Link } from 'react-router-dom';
import { BellIcon, MenuIcon } from './icons';
import useApp from '../context/useApp';
import useAuthorization from '../auth/useAuthorization.js';
import { AUTHORIZATION_MODES } from '../auth/AuthorizationProvider.jsx';
import { getRoleDefinition } from '../auth/roles.js';
import { APPLICATION_ROUTES } from '../auth/routeAccess.js';

function formatUpdatedTime(timestamp) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

/**
 * `identity` is reserved for the future authenticated profile contract:
 * { name, role, accountStatus, lastLoginAt }. It remains null until real auth exists.
 */
export default function Topbar({ mobileNavOpen, onMenuToggle, identity = null }) {
  const { lastUpdated } = useApp();
  const { mode, effectiveRole } = useAuthorization();
  const previewRole = mode === AUTHORIZATION_MODES.ROLE_PREVIEW
    ? getRoleDefinition(effectiveRole)
    : null;
  void identity;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="topbar-icon-btn mobile-menu-btn"
          aria-label="Toggle navigation menu"
          aria-controls="primary-navigation"
          aria-expanded={mobileNavOpen}
          onClick={onMenuToggle}
        >
          <MenuIcon width={19} height={19} />
        </button>
        <div className="topbar-context">
          <span className="topbar-title">Continuous Auditing</span>
          <span className="topbar-organization">Retail Store Operations</span>
        </div>
      </div>
      <div className="topbar-right">
        {previewRole && (
          <>
            <span className={`topbar-access-state role-badge role-${previewRole.key.toLowerCase()}`}>
              Role Preview: {previewRole.displayName}
            </span>
            <Link
              className="topbar-profile-preview-link"
              to={APPLICATION_ROUTES.PROFILE}
              aria-label="Open profile preview (development only)"
            >
              Profile
            </Link>
          </>
        )}
        <span className="updated-time">
          <span>Data updated</span>
          <strong>{formatUpdatedTime(lastUpdated)}</strong>
        </span>
        <button
          type="button"
          className="topbar-icon-btn"
          aria-label="Notifications are not available yet"
          title="Notifications are not available yet"
          disabled
        >
          <BellIcon width={17} height={17} />
        </button>
      </div>
    </header>
  );
}
