import { Link, NavLink } from 'react-router-dom';
import {
  ShieldIcon,
  GridIcon,
  ListIcon,
  AlertIcon,
  CheckShieldIcon,
  ReportIcon,
  SettingsIcon,
  XIcon,
  LockIcon,
  ClipboardCheckIcon,
} from './icons';
import RolePreviewControl from '../auth/RolePreviewControl.jsx';
import { NAVIGATION_GROUPS, getNavigationState } from '../auth/navigationConfig.js';
import { APPLICATION_ROUTES } from '../auth/routeAccess.js';
import useAuthorization from '../auth/useAuthorization.js';

const NAVIGATION_ICONS = Object.freeze({
  dashboard: GridIcon,
  transactions: ListIcon,
  alerts: AlertIcon,
  'audit-rules': CheckShieldIcon,
  reports: ReportIcon,
  settings: SettingsIcon,
  'audit-log': ClipboardCheckIcon,
});

export default function Sidebar({ isOpen, onClose }) {
  const { effectiveRole } = useAuthorization();
  const navigationGroups = effectiveRole ? getNavigationState(effectiveRole) : NAVIGATION_GROUPS;

  return (
    <aside id="primary-navigation" className={`sidebar${isOpen ? ' mobile-open' : ''}`}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-label">
          <span className="sidebar-brand-icon"><ShieldIcon width={16} height={16} /></span>
          <span>Audit System</span>
        </div>
        <button type="button" className="sidebar-close-btn" aria-label="Close navigation" onClick={onClose}>
          <XIcon width={18} height={18} />
        </button>
      </div>
      <nav className="sidebar-nav" aria-label="Primary navigation">
        {navigationGroups.map((group) => (
          <div className="sidebar-nav-group" key={group.label}>
            <span className="sidebar-nav-label">{group.label}</span>
            {group.links.map(({ to, label, icon, end, restricted = false }) => {
              const Icon = NAVIGATION_ICONS[icon];
              if (restricted) {
                return (
                  <Link
                    key={to}
                    to={APPLICATION_ROUTES.FORBIDDEN}
                    state={{ from: to }}
                    className="sidebar-link is-restricted"
                    aria-label={`${label}. Restricted. Requires additional permission.`}
                    onClick={onClose}
                  >
                    <Icon />
                    <span>{label}</span>
                    <span className="sidebar-restricted-label">
                      <LockIcon aria-hidden="true" />
                      Locked
                    </span>
                  </Link>
                );
              }

              return (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
                  onClick={onClose}
                >
                  <Icon />
                  <span>{label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>
      <RolePreviewControl />
    </aside>
  );
}
