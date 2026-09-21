import { BellIcon, MenuIcon, ShieldIcon } from './icons';
import useApp from '../context/useApp';

function formatUpdatedTime(timestamp) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(timestamp));
}

export default function Topbar({ mobileNavOpen, onMenuToggle }) {
  const { lastUpdated } = useApp();

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
        <ShieldIcon width={20} height={20} color="#2563eb" />
        <span className="topbar-title">Continuous Auditing System</span>
        <span className="topbar-organization">Retail Store Operations</span>
        <span className="demo-mode-chip">Demo Mode</span>
      </div>
      <div className="topbar-right">
        <span className="updated-time">Last Updated: {formatUpdatedTime(lastUpdated)}</span>
        <button
          type="button"
          className="topbar-icon-btn"
          aria-label="Notifications unavailable until backend integration"
          title="Available after backend integration"
          disabled
        >
          <BellIcon width={17} height={17} />
        </button>
        <span className="avatar" aria-label="Team M004">M4</span>
      </div>
    </header>
  );
}
