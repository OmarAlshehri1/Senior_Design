import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ROLE_KEYS } from '../auth/roles.js';
import { deriveWorkspaceData } from '../auth/workspace.js';
import { loadAdminWorkspaceData } from '../management/adminWorkspaceService.js';

function MetricValue({ value, loading }) {
  if (loading) return <span>Loading…</span>;
  if (value === null || value === undefined) return <span aria-label="Unavailable">—</span>;
  return <span>{value}</span>;
}

function eventLabel(action) {
  return (action ?? 'System event').toLowerCase().split('_').map((part) => (
    part.charAt(0).toUpperCase() + part.slice(1)
  )).join(' ');
}

function eventTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function WorkspaceEvents({ section, loading }) {
  if (section.error) {
    return <div className="workspace-unavailable" role="status"><span aria-hidden="true">!</span><p>{section.error}</p></div>;
  }
  if (loading) {
    return <div className="workspace-unavailable" role="status"><span aria-hidden="true">…</span><p>Loading recent activity…</p></div>;
  }
  if (!section.items.length) {
    return <div className="workspace-unavailable"><span aria-hidden="true">—</span><p>{section.emptyMessage}</p></div>;
  }
  return (
    <ul className="workspace-event-list">
      {section.items.map((event) => (
        <li key={event.id}>
          <span className="workspace-event-name">{eventLabel(event.action)}</span>
          <span className="workspace-event-meta">
            {event.actorName || 'System'}
            {event.actorRole ? ` · ${event.actorRole}` : ''}
            {eventTime(event.timestamp) ? ` · ${eventTime(event.timestamp)}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function RoleWorkspace({ role, transactions }) {
  const [adminData, setAdminData] = useState(null);
  const [adminLoading, setAdminLoading] = useState(false);

  useEffect(() => {
    if (role !== ROLE_KEYS.ADMIN) {
      setAdminData(null);
      setAdminLoading(false);
      return undefined;
    }

    let active = true;
    setAdminLoading(true);
    loadAdminWorkspaceData().then((data) => {
      if (active) setAdminData(data);
    }).catch(() => {
      if (active) setAdminData(null);
    }).finally(() => {
      if (active) setAdminLoading(false);
    });
    return () => { active = false; };
  }, [role]);

  const workspace = deriveWorkspaceData(role, { transactions, adminData });

  if (!workspace.role) {
    return (
      <section className="workspace-foundation workspace-neutral" aria-labelledby="workspace-heading">
        <div>
          <h2 id="workspace-heading">Your Workspace</h2>
          <p>{workspace.message}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="role-workspace" aria-labelledby="workspace-heading">
      <header className="role-workspace-header">
        <div>
          <p className="workspace-eyebrow">Your Workspace</p>
          <h2 id="workspace-heading">{workspace.roleLabel}</h2>
        </div>
        <span className={`role-badge role-${workspace.role.toLowerCase()}`}>{workspace.contextLabel}</span>
      </header>

      <div className="workspace-metrics" aria-label={`${workspace.roleLabel} workspace metrics`}>
        {workspace.metrics.map((metric) => {
          const metricErrorKey = metric.key === 'failedLoginsToday' ? 'failedLogins' : 'users';
          return (
            <article className="workspace-metric" key={metric.key}>
              <p>{metric.label}</p>
              <strong><MetricValue value={metric.value} loading={role === ROLE_KEYS.ADMIN && adminLoading} /></strong>
              <span>{workspace.metricErrors[metricErrorKey] ?? metric.description}</span>
              {metric.to && <Link to={metric.to}>Open</Link>}
            </article>
          );
        })}
      </div>

      <div className="workspace-activity-grid">
        {workspace.sections.map((section) => (
          <section className="workspace-activity" aria-labelledby={`workspace-${section.key}`} key={section.key}>
            <h3 id={`workspace-${section.key}`}>{section.title}</h3>
            {section.to && <Link className="workspace-section-link" to={section.to}>View</Link>}
            <WorkspaceEvents section={section} loading={role === ROLE_KEYS.ADMIN && adminLoading} />
          </section>
        ))}
      </div>
    </section>
  );
}
