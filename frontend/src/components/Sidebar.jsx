import { NavLink } from 'react-router-dom';
import {
  ShieldIcon,
  GridIcon,
  ListIcon,
  AlertIcon,
  CheckShieldIcon,
  ReportIcon,
  SettingsIcon,
  XIcon,
} from './icons';

const links = [
  { to: '/', label: 'Dashboard', icon: GridIcon, end: true },
  { to: '/transactions', label: 'Transactions', icon: ListIcon },
  { to: '/alerts', label: 'Alerts', icon: AlertIcon },
  { to: '/audit-rules', label: 'Audit Rules', icon: CheckShieldIcon },
  { to: '/reports', label: 'Reports', icon: ReportIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export default function Sidebar({ isOpen, onClose }) {
  return (
    <aside id="primary-navigation" className={`sidebar${isOpen ? ' mobile-open' : ''}`}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-label">
          <span className="sidebar-brand-icon">
            <ShieldIcon width={16} height={16} />
          </span>
          <span>Audit System</span>
        </div>
        <button type="button" className="sidebar-close-btn" aria-label="Close navigation" onClick={onClose}>
          <XIcon width={18} height={18} />
        </button>
      </div>
      <nav className="sidebar-nav" aria-label="Primary navigation">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
            onClick={onClose}
          >
            <Icon />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
