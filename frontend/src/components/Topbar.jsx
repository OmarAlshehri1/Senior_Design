import { useCallback, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BellIcon, MenuIcon } from './icons';
import useApp from '../context/useApp';
import useAuthorization from '../auth/useAuthorization.js';
import { AUTHORIZATION_MODES } from '../auth/AuthorizationProvider.jsx';
import { getRoleDefinition } from '../auth/roles.js';
import { APPLICATION_ROUTES } from '../auth/routeAccess.js';
import NotificationCenter from './NotificationCenter.jsx';
import { getUnreadNotificationCount } from '../notifications/notifications.js';
import { authService } from '../auth/authService.js';
import { AUTH_ROUTES } from '../auth/authRoutes.js';

const NOTIFICATIONS = Object.freeze([]);

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
export default function Topbar({ mobileNavOpen, onMenuToggle, menuButtonRef, identity = null }) {
  const { lastUpdated } = useApp();
  const { mode, effectiveRole, user } = useAuthorization();
  const navigate = useNavigate();
  const previewRole = mode === AUTHORIZATION_MODES.ROLE_PREVIEW
    ? getRoleDefinition(effectiveRole)
    : null;
  void identity;
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationButtonRef = useRef(null);
  const closeNotifications = useCallback(() => setNotificationsOpen(false), []);
  const unreadCount = getUnreadNotificationCount(NOTIFICATIONS);

  const handleSignOut = async () => {
    try { await authService.signOut(); } catch { /* Local credentials are cleared by the service. */ }
    navigate(AUTH_ROUTES.LOGIN, { replace: true });
  };

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          ref={menuButtonRef}
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
        {user && <button type="button" className="topbar-profile-preview-link" onClick={handleSignOut}>Sign out</button>}
        <span className="updated-time">
          <span>Data updated</span>
          <strong>{formatUpdatedTime(lastUpdated)}</strong>
        </span>
        <div className="notification-center-anchor">
          <button ref={notificationButtonRef} type="button" className="topbar-icon-btn notification-center-trigger" aria-label="Open notifications" aria-controls="notification-center" aria-expanded={notificationsOpen} onClick={() => setNotificationsOpen((open) => !open)}>
            <BellIcon width={17} height={17} />
            {unreadCount > 0 && <span className="notification-count">{unreadCount}</span>}
          </button>
          <NotificationCenter open={notificationsOpen} notifications={NOTIFICATIONS} onClose={closeNotifications} returnFocusRef={notificationButtonRef} />
        </div>
      </div>
    </header>
  );
}
