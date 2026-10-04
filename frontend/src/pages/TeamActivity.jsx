import { useEffect, useState } from 'react';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import TeamActivityFeed from '../components/TeamActivityFeed.jsx';
import { teamService } from '../team/teamService.js';
import useAuthorization from '../auth/useAuthorization.js';
import { userManagementService } from '../management/userManagementService.js';

const EMPTY = { teams: [], overview: {}, workload: [], activity: [] };

export default function TeamActivity() {
  const { effectiveRole } = useAuthorization();
  const [teams, setTeams] = useState([]);
  const [teamId, setTeamId] = useState('');
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [supervisors, setSupervisors] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [teamName, setTeamName] = useState('');
  const [supervisorId, setSupervisorId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [teamNameEdit, setTeamNameEdit] = useState('');
  const [teamSupervisorEdit, setTeamSupervisorEdit] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    teamService.getTeams().then((rows) => {
      if (!active) return;
      const available = Array.isArray(rows) ? rows : [];
      setTeams(available);
      if (available.length === 1) setTeamId(available[0].id);
    }).catch((reason) => { if (active) setError(reason.message || 'Teams could not be loaded.'); });
    return () => { active = false; };
  }, [refreshKey]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    teamService.getTeamActivity(teamId || null).then((result) => {
      if (!active) return;
      setData({ ...EMPTY, ...result });
      setError(null);
    }).catch((reason) => { if (active) setError(reason.message || 'Team activity could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [teamId, refreshKey]);

  useEffect(() => {
    if (effectiveRole !== 'ADMIN') return undefined;
    let active = true;
    userManagementService.listUsers({ query: { page: 1, page_size: 100 } }).then((result) => {
      if (active) setSupervisors(result.items.filter((user) => user.role === 'SUPERVISOR' && user.accountStatus === 'ACTIVE'));
    }).catch((reason) => { if (active) setError(reason.message || 'Eligible supervisors could not be loaded.'); });
    return () => { active = false; };
  }, [effectiveRole]);

  useEffect(() => {
    if (!teamId) { setCandidates([]); return undefined; }
    let active = true;
    teamService.getMemberCandidates(teamId).then((rows) => {
      if (active) setCandidates(Array.isArray(rows) ? rows : []);
    }).catch((reason) => { if (active) setError(reason.message || 'Team members could not be loaded.'); });
    return () => { active = false; };
  }, [teamId, refreshKey]);

  const selectedTeam = teams.find((team) => team.id === teamId) ?? null;
  useEffect(() => {
    setTeamNameEdit(selectedTeam?.name ?? '');
    setTeamSupervisorEdit(selectedTeam?.supervisor_id ?? '');
  }, [selectedTeam?.id, selectedTeam?.name, selectedTeam?.supervisor_id]);

  const runManagementAction = async (action) => {
    setSaving(true);
    setError(null);
    try { await action(); setRefreshKey((value) => value + 1); }
    catch (reason) { setError(reason.message || 'Team change could not be saved.'); }
    finally { setSaving(false); }
  };

  const overview = data.overview ?? {};
  const metrics = [
    ['Team Members', overview.team_members], ['Active Assignments', overview.active_assignments],
    ['Reviews Today', overview.reviews_today], ['Open Alerts', overview.open_alerts],
  ];
  const events = (data.activity ?? []).map((event) => ({
    ...event, actorName: event.actor_name, actorRole: event.actor_role,
    resourceId: event.resource_id, timestamp: event.created_at,
  }));

  return (
    <div className="management-page team-activity-page">
      <div className="page-header"><div><h1>Team Activity</h1><p>Review team workload and recent audit activity.</p></div>
        {effectiveRole === 'ADMIN' && teams.length > 0 && <label className="alerts-select-control"><span className="control-label">Team</span>
          <select className="select-input" value={teamId} onChange={(event) => setTeamId(event.target.value)}><option value="">All Teams</option>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
      </div>
      {error && <p role="alert" className="integration-note">{error}</p>}
      {effectiveRole === 'ADMIN' && <section className="management-detail-card" aria-labelledby="create-team-heading">
        <h2 id="create-team-heading">Create Team</h2><div className="management-form-grid">
          <label className="dialog-field"><span>Team Name</span><input value={teamName} maxLength={120} onChange={(event) => setTeamName(event.target.value)} /></label>
          <label className="dialog-field"><span>Active Supervisor</span><select value={supervisorId} onChange={(event) => setSupervisorId(event.target.value)}><option value="">Select a Supervisor</option>
            {supervisors.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label>
          <button type="button" className="btn btn-primary" disabled={saving || !teamName.trim() || !supervisorId}
            onClick={() => runManagementAction(async () => { const created = await teamService.createTeam(teamName.trim(), supervisorId); setTeamId(created.id); setTeamName(''); })}>Create Team</button>
        </div>
      </section>}
      {selectedTeam && <section className="management-detail-card" aria-labelledby="manage-team-heading">
        <h2 id="manage-team-heading">Manage {selectedTeam.name}</h2>
        {effectiveRole === 'ADMIN' && <div className="management-form-grid">
          <label className="dialog-field"><span>Team Name</span><input value={teamNameEdit} maxLength={120} onChange={(event) => setTeamNameEdit(event.target.value)} /></label>
          <label className="dialog-field"><span>Supervisor</span><select value={teamSupervisorEdit} onChange={(event) => setTeamSupervisorEdit(event.target.value)}>
            {supervisors.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label>
          <button type="button" className="btn btn-secondary" disabled={saving || !teamNameEdit.trim() || !teamSupervisorEdit}
            onClick={() => runManagementAction(() => teamService.updateTeam(teamId, { name: teamNameEdit.trim(), supervisorId: teamSupervisorEdit }))}>Save Team</button>
        </div>}
        <div className="management-form-grid"><label className="dialog-field"><span>Active Auditor</span>
          <select value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">Select an Auditor</option>
            {candidates.filter((candidate) => candidate.team_id !== teamId).map((candidate) => <option value={candidate.id} key={candidate.id}>
              {candidate.name}{candidate.team_id ? ` (Transfer from ${teams.find((team) => team.id === candidate.team_id)?.name ?? 'another team'})` : ''}</option>)}
          </select></label>
          <button type="button" className="btn btn-secondary" disabled={saving || !memberId} onClick={() => {
            const candidate = candidates.find((item) => item.id === memberId);
            runManagementAction(() => teamService.updateMember(teamId, memberId, candidate?.team_id ? 'TRANSFER' : 'ADD')).then(() => setMemberId(''));
          }}>Add / Transfer Auditor</button>
        </div>
        <div className="management-table-wrap compact"><table className="management-table"><thead><tr><th>Team Member</th><th>Role</th><th>Action</th></tr></thead><tbody>
          {data.workload.filter((member) => member.team_id === teamId && member.role === 'AUDITOR').map((member) => <tr key={member.user_id}><td>{member.name}</td><td>{member.role}</td>
            <td><button type="button" className="btn btn-secondary" disabled={saving} onClick={() => runManagementAction(() => teamService.updateMember(teamId, member.user_id, 'REMOVE'))}>Remove</button></td></tr>)}
        </tbody></table></div>
      </section>}
      <section aria-labelledby="team-overview-heading"><div className="management-section-heading"><div><h2 id="team-overview-heading">Team Overview</h2><p>Current team capacity and audit workload.</p></div></div>
        <div className="management-summary">{metrics.map(([label, value]) => <article key={label}><span>{label}</span><strong>{loading ? '…' : (value ?? '—')}</strong></article>)}</div>
      </section>
      <div className="team-activity-grid">
        <section className="management-detail-card" aria-labelledby="recent-team-activity-heading"><h2 id="recent-team-activity-heading">Recent Activity</h2>
          <p className="card-description">Reviews and assignment actions recorded for this team.</p><TeamActivityFeed events={events} /></section>
        <section className="management-detail-card" aria-labelledby="team-workload-heading"><h2 id="team-workload-heading">Team Workload</h2>
          <p className="card-description">Assignment and review workload by team member.</p>
          <div className="management-table-wrap team-workload-table-wrap compact"><table className="management-table team-workload-table"><thead><tr><th>User</th><th>Role</th><th>Assigned Alerts</th><th>Open Reviews</th><th>Completed Today</th></tr></thead>
            <tbody>{data.workload.map((member) => <tr key={member.user_id}><td data-label="User">{member.name}</td><td data-label="Role">{member.role}</td><td data-label="Assigned Alerts">{member.assigned_alerts}</td><td data-label="Open Reviews">{member.open_reviews}</td><td data-label="Completed Today">{member.completed_today}</td></tr>)}</tbody></table>
            {!loading && data.workload.length === 0 && <ManagementEmptyState title="No team workload is available yet." />}</div>
        </section>
      </div>
    </div>
  );
}
