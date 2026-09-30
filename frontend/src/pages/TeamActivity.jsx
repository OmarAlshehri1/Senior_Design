import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import { createTeamActivityModel } from '../team/teamActivity.js';
import TeamActivityFeed from '../components/TeamActivityFeed.jsx';

const TEAM_ACTIVITY = createTeamActivityModel();

export default function TeamActivity() {
  const metrics = [
    ['Team Members', TEAM_ACTIVITY.overview.teamMembers],
    ['Active Assignments', TEAM_ACTIVITY.overview.activeAssignments],
    ['Reviews Today', TEAM_ACTIVITY.overview.reviewsToday],
    ['Open Alerts', TEAM_ACTIVITY.overview.openAlerts],
  ];

  return (
    <div className="management-page team-activity-page">
      <div className="page-header"><div><h1>Team Activity</h1><p>Review team workload and recent audit activity.</p></div></div>
      <section aria-labelledby="team-overview-heading">
        <div className="management-section-heading"><div><h2 id="team-overview-heading">Team Overview</h2><p>Current team capacity and audit workload.</p></div></div>
        <div className="management-summary">{metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong aria-label="Unavailable">{value ?? '—'}</strong></article>)}</div>
      </section>
      <div className="team-activity-grid">
        <section className="management-detail-card" aria-labelledby="recent-team-activity-heading">
          <h2 id="recent-team-activity-heading">Recent Activity</h2>
          <p className="card-description">Reviews and assignment actions will appear as accountable events.</p>
          <TeamActivityFeed events={TEAM_ACTIVITY.activity} />
        </section>
        <section className="management-detail-card" aria-labelledby="team-workload-heading">
          <h2 id="team-workload-heading">Team Workload</h2>
          <p className="card-description">Assignment and review workload by team member.</p>
          <div className="management-table-wrap compact"><table className="management-table"><thead><tr><th>User</th><th>Role</th><th>Assigned Alerts</th><th>Open Reviews</th><th>Completed Today</th></tr></thead><tbody /></table><ManagementEmptyState title="No team workload is available yet." /></div>
        </section>
      </div>
    </div>
  );
}
