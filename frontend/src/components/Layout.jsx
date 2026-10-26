import { useMemo, useRef, useState } from 'react';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import Notification from './Notification';
import useOverlayFocus from '../accessibility/useOverlayFocus.js';

export default function Layout({ children, identity = null }) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const sidebarRef = useRef(null);
  const sidebarCloseRef = useRef(null);
  const menuButtonRef = useRef(null);
  const mainAreaRef = useRef(null);
  const inertRefs = useMemo(() => [mainAreaRef], []);

  useOverlayFocus({
    active: mobileNavOpen,
    containerRef: sidebarRef,
    initialFocusRef: sidebarCloseRef,
    restoreFocusRef: menuButtonRef,
    onEscape: () => setMobileNavOpen(false),
    inertRefs,
  });

  return (
    <div className="app-shell">
      <Sidebar containerRef={sidebarRef} closeButtonRef={sidebarCloseRef} isOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
      {mobileNavOpen && (
        <button
          type="button"
          className="mobile-nav-overlay"
          aria-label="Close navigation menu"
          tabIndex="-1"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <div ref={mainAreaRef} className="main-area">
        <Topbar
          identity={identity}
          menuButtonRef={menuButtonRef}
          mobileNavOpen={mobileNavOpen}
          onMenuToggle={() => setMobileNavOpen((open) => !open)}
        />
        <main className="page-content">{children}</main>
      </div>
      <Notification />
    </div>
  );
}
