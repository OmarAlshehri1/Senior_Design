import { BellIcon, MenuIcon } from './icons';
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
        <div className="topbar-context">
          <span className="topbar-title">Continuous Auditing</span>
          <span className="topbar-organization">Retail Store Operations</span>
        </div>
      </div>
      <div className="topbar-right">
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
