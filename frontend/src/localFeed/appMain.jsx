import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, NavLink, Route, Routes } from 'react-router-dom';
import Layout from '../components/Layout.jsx';
import Transactions from '../pages/Transactions.jsx';
import { ListIcon, MenuIcon, ShieldIcon, XIcon } from '../components/icons';
import LocalFeed from './LocalFeed.jsx';
import '../index.css';
import '../refresh.css';
import './localFeed.css';

function LocalNavigation({ containerRef, closeButtonRef, isOpen, onClose }) {
  return <aside ref={containerRef} tabIndex="-1" id="primary-navigation" className={`sidebar${isOpen ? ' mobile-open' : ''}`}>
    <div className="sidebar-brand"><div className="sidebar-brand-label"><span className="sidebar-brand-icon"><ShieldIcon /></span><span>Audit System</span></div>
      <button ref={closeButtonRef} className="sidebar-close-btn" aria-label="Close navigation" onClick={onClose}><XIcon /></button></div>
    <nav className="sidebar-nav" aria-label="Primary navigation"><div className="sidebar-nav-group">
      <span className="sidebar-nav-label">LOCAL PAYMENTS</span>
      <NavLink to="/transactions" className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`} onClick={onClose}><ListIcon /><span>Transactions</span></NavLink>
      <a className="sidebar-link" href="/local-feed.html">Simulation controls</a>
    </div></nav>
  </aside>;
}

function LocalTopbar({ menuButtonRef, mobileNavOpen, onMenuToggle }) {
  return <header className="topbar"><div className="topbar-left">
    <button ref={menuButtonRef} className="topbar-icon-btn mobile-menu-btn" aria-label="Toggle navigation menu"
      aria-controls="primary-navigation" aria-expanded={mobileNavOpen} onClick={onMenuToggle}><MenuIcon /></button>
    <div className="topbar-context"><span className="topbar-title">Continuous Auditing</span><span className="topbar-organization">Payments simulation</span></div>
  </div><span className="local-feed-environment">LOCAL ONLY</span></header>;
}

const local = import.meta.env.DEV && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
function LocalApplication() {
  return <HashRouter><Layout SidebarComponent={LocalNavigation} TopbarComponent={LocalTopbar} showNotification={false}>
    <Routes><Route path="/transactions" element={<Transactions feedView={<LocalFeed embedded />} />} />
      <Route path="*" element={<Navigate to="/transactions" replace />} /></Routes>
  </Layout></HashRouter>;
}

createRoot(document.getElementById('root')).render(<StrictMode>
  {local ? <LocalApplication /> : <p>This view is available in a local simulation session only.</p>}
</StrictMode>);
