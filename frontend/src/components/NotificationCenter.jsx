import { useEffect, useRef } from 'react';
import { getUnreadNotificationCount, isNotificationUnread, NOTIFICATION_TYPES } from '../notifications/notifications.js';

const SECURITY_TYPES = new Set([
  NOTIFICATION_TYPES.ACCOUNT_LOCKED,
  NOTIFICATION_TYPES.ACCOUNT_UNLOCKED,
  NOTIFICATION_TYPES.SECURITY_ALERT,
]);

export default function NotificationCenter({ open, notifications = [], onClose, returnFocusRef,
  loading = false, error = null, unreadCount: unreadCountProp = null, onMarkRead, onMarkAllRead }) {
  const panelRef = useRef(null);
  const headingRef = useRef(null);
  const unreadCount = Number.isFinite(unreadCountProp)
    ? unreadCountProp : getUnreadNotificationCount(notifications);

  useEffect(() => {
    if (!open) return undefined;
    headingRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        onClose();
        returnFocusRef?.current?.focus();
      }
    };
    const handlePointerDown = (event) => {
      if (!panelRef.current?.contains(event.target) && event.target !== returnFocusRef?.current) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [onClose, open, returnFocusRef]);

  if (!open) return null;

  return (
    <section ref={panelRef} id="notification-center" className="notification-center" aria-labelledby="notification-center-heading">
      <header>
        <div><h2 id="notification-center-heading" ref={headingRef} tabIndex="-1">Notifications</h2>{unreadCount > 0 && <p>{unreadCount} unread</p>}</div>
        <button type="button" className="notification-mark-all" onClick={onMarkAllRead} disabled={loading || unreadCount === 0}>Mark All as Read</button>
      </header>
      {loading && notifications.length === 0 ? (
        <div className="notification-center-empty" role="status"><p>Loading notifications…</p></div>
      ) : error ? (
        <div className="notification-center-empty" role="alert"><p>{error}</p></div>
      ) : notifications.length === 0 ? (
        <div className="notification-center-empty" role="status"><span aria-hidden="true">—</span><p>No notifications are available yet.</p></div>
      ) : (
        <ol className="notification-list">
          {notifications.map((notification) => (
            <li className={`${isNotificationUnread(notification) ? 'is-unread' : 'is-read'}${SECURITY_TYPES.has(notification.type) ? ' is-security' : ''}`} key={notification.id}>
              <div><strong>{notification.title}</strong><span>{notification.priority}</span></div>
              <p>{notification.message}</p>
              <time dateTime={notification.timestamp}>{notification.timestamp}</time>
              {isNotificationUnread(notification) && <button type="button" onClick={() => onMarkRead?.(notification.id)}>Mark as Read</button>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
