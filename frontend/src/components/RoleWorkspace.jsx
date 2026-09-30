import { deriveWorkspaceData } from '../auth/workspace.js';
import { Link } from 'react-router-dom';

function MetricValue({ value }) {
  if (value === null || value === undefined) return <span aria-label="Unavailable">—</span>;
  return <span>{value}</span>;
}

export default function RoleWorkspace({ role, transactions }) {
  const workspace = deriveWorkspaceData(role, { transactions });

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
        {workspace.metrics.map((metric) => (
          <article className="workspace-metric" key={metric.key}>
            <p>{metric.label}</p>
            <strong><MetricValue value={metric.value} /></strong>
            <span>{metric.description}</span>
            {metric.to && <Link to={metric.to}>Open</Link>}
          </article>
        ))}
      </div>

      <div className="workspace-activity-grid">
        {workspace.sections.map((section) => (
          <section className="workspace-activity" aria-labelledby={`workspace-${section.key}`} key={section.key}>
            <h3 id={`workspace-${section.key}`}>{section.title}</h3>
            {section.to && <Link className="workspace-section-link" to={section.to}>View</Link>}
            <div className="workspace-unavailable">
              <span aria-hidden="true">—</span>
              <p>{section.emptyMessage}</p>
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}
