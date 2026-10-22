import useApp from '../context/useApp';

export default function Notification() {
  const { notification } = useApp();
  if (!notification) return null;

  return <Toast notification={notification} />;
}

export function Toast({ notification }) {
  const urgent = notification.type === 'error';

  return (
    <div key={notification.key} className={`toast toast-${notification.type}`}
      role={urgent ? 'alert' : 'status'} aria-live={urgent ? 'assertive' : 'polite'} aria-atomic="true">
      {notification.message}
    </div>
  );
}
