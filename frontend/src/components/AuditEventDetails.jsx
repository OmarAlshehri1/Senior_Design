import { useEffect, useRef } from 'react';

const displayDetails = (details) => {
  if (details === null || details === undefined) return 'Not available';
  return typeof details === 'string' ? details : JSON.stringify(details);
};

export default function AuditEventDetails({ event, onClose }) {
  const headingRef = useRef(null);

  useEffect(() => {
    if (event) headingRef.current?.focus();
  }, [event]);

  if (!event) return null;

  return (
    <aside className="audit-event-details" aria-labelledby="audit-event-details-heading">
      <header>
        <h2 id="audit-event-details-heading" ref={headingRef} tabIndex="-1">Activity Details</h2>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
      </header>
      <dl>
        <div><dt>Actor</dt><dd>{event.actorName ?? 'Not available'}</dd></div>
        <div><dt>Role</dt><dd>{event.actorRole ?? 'Not available'}</dd></div>
        <div><dt>Action</dt><dd>{event.action ?? 'Not available'}</dd></div>
        <div><dt>Resource</dt><dd>{event.resourceId ?? 'Not available'}</dd></div>
        <div><dt>Timestamp</dt><dd>{event.timestamp ?? 'Not available'}</dd></div>
        <div><dt>Outcome</dt><dd>{event.outcome ?? 'Not available'}</dd></div>
        <div><dt>Details</dt><dd>{displayDetails(event.details)}</dd></div>
      </dl>
    </aside>
  );
}
