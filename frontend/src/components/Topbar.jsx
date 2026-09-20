import { ShieldIcon, RefreshIcon, BellIcon } from './icons';

export default function Topbar() {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <ShieldIcon width={20} height={20} color="#2563eb" />
        <span className="topbar-title">Continuous Auditing System</span>
        <span className="topbar-select">Retail Store Operations ▾</span>
      </div>
      <div className="topbar-right">
        <RefreshIcon width={15} height={15} />
        <span>Last Updated: Just now</span>
        <button className="topbar-icon-btn" aria-label="Notifications">
          <BellIcon width={17} height={17} />
        </button>
        <span className="avatar">AM</span>
      </div>
    </header>
  );
}
