import DateTime from './DateTime.jsx';
import { Dialog } from './ui/Overlays.jsx';
import { eventLabel } from '../utils/presentation.js';

const displayDetails = (details) => {
  if (details === null || details === undefined) return 'Not available';
  return typeof details === 'string' ? details : JSON.stringify(details);
};

export default function AuditEventDetails({ event, onClose = () => {} }) {
  if (!event) return null;

  return (
    <Dialog open variant="drawer" eyebrow="Audit evidence" title={eventLabel(event.action)} description="Original recorded values, exactly as stored." onClose={onClose}>
      <dl className="key-values columns-1 audit-evidence">
        <div><dt>Actor</dt><dd>{event.actorName ?? 'Not available'}</dd></div>
        <div><dt>Role</dt><dd>{event.actorRole ?? 'Not available'}</dd></div>
        <div><dt>Action code</dt><dd className="reference-text">{event.action ?? 'Not available'}</dd></div>
        <div><dt>Resource</dt><dd className="reference-text">{event.resourceType ? `${event.resourceType} · ` : ''}{event.resourceId ?? 'Not available'}</dd></div>
        <div><dt>Timestamp</dt><dd><DateTime value={event.timestamp} seconds showZone /></dd></div>
        <div><dt>Event ID</dt><dd className="reference-text">{event.id ?? 'Not available'}</dd></div>
        <div><dt>Outcome</dt><dd>{event.outcome ?? 'Not available'}</dd></div>
        <div><dt>Recorded details (raw)</dt><dd><pre className="raw-evidence">{displayDetails(event.details)}</pre></dd></div>
      </dl>
    </Dialog>
  );
}
