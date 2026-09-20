import { useApp } from '../context/AppContext';

export default function Notification() {
  const { notification } = useApp();
  if (!notification) return null;

  return (
    <div key={notification.key} className={`toast toast-${notification.type}`}>
      {notification.message}
    </div>
  );
}
