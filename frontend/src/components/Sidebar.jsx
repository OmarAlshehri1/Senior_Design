import { NavLink } from 'react-router-dom';
import {
  ShieldIcon,
  GridIcon,
  ListIcon,
  AlertIcon,
  CheckShieldIcon,
  ReportIcon,
  SettingsIcon,
} from './icons';

const links = [
  { to: '/', label: 'Dashboard', icon: GridIcon, end: true },
  { to: '/transactions', label: 'Transactions', icon: ListIcon },
  { to: '/alerts', label: 'Alerts', icon: AlertIcon },
  { to: '/audit-rules', label: 'Audit Rules', icon: CheckShieldIcon },
  { to: '/reports', label: 'Reports', icon: ReportIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="sidebar-brand-icon">
          <ShieldIcon width={16} height={16} />
        </span>
        <span>Audit System</span>
      </div>
      <nav className="sidebar-nav">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
          >
            <Icon />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
