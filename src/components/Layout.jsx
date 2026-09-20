import Sidebar from './Sidebar';
import Topbar from './Topbar';
import Notification from './Notification';

export default function Layout({ children }) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main-area">
        <Topbar />
        <div className="page-content">{children}</div>
      </div>
      <Notification />
    </div>
  );
}
