import { useEffect, useState } from 'react';
import { eventLabel } from '../utils/presentation.js';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import { MetricStrip, PageHeader, Panel } from '../components/ui/Layout.jsx';
import { SelectField } from '../components/ui/Filters.jsx';
import { LoadingState } from '../components/RequestStateView.jsx';
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
    setData(EMPTY);
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
  const openReviews = data.workload.length && data.workload.every((member) => Number.isFinite(member.open_reviews))
    ? data.workload.reduce((sum, member) => sum + member.open_reviews, 0) : undefined;
  const metrics = [
    ['Members', overview.team_members], ['Assignments', overview.active_assignments],
    ['Open reviews', openReviews], ['Open alerts', overview.open_alerts],
  ];
  const events = (data.activity ?? []).map((event) => ({
    ...event, actorName: event.actor_name, actorRole: event.actor_role,
    resourceId: event.resource_id, resourceType: event.resource_type, timestamp: event.created_at,
  }));

  return (
    <div className="page team-activity-page">
      <PageHeader title="Team Activity" description="Workload and recent actions for your audit team."
        actions={effectiveRole === 'ADMIN' && teams.length > 0 && <SelectField label="Team" value={teamId} onChange={setTeamId}
          options={[{ value: '', label: 'All teams' }, ...teams.map((team) => ({ value: team.id, label: team.name }))]} />} />
      {error && <p role="alert" className="inline-alert">{error}</p>}
      <section aria-labelledby="team-overview-heading">
        <h2 id="team-overview-heading" className="sr-only">Team Overview</h2>
        <MetricStrip label="Team overview" loading={loading} items={[
          { label: metrics[0][0], value: metrics[0][1], hint: 'In the selected team', tone: 'primary' },
          { label: metrics[1][0], value: metrics[1][1], hint: 'Alerts assigned now' },
          { label: metrics[2][0], value: metrics[2][1], hint: 'Assigned, not yet reviewed', tone: 'medium' },
          { label: metrics[3][0], value: metrics[3][1], hint: 'Active in team scope', tone: 'high' },
        ]} />
      </section>
      <div className="team-activity-grid">
        <Panel id="recent-team-activity-heading" title="Recent activity" description="Latest recorded actions for the selected team.">
          {loading ? <LoadingState compact message="Loading recent activity…" /> : error ? <p className="muted">Recent activity is unavailable.</p> : <TeamActivityFeed key={teamId} events={events} />}
        </Panel>
        <Panel id="team-workload-heading" title="Workload" description="Assignments and reviews by team member." flush>
          {loading ? <LoadingState compact message="Loading workload…" /> : data.workload.length === 0 ? <ManagementEmptyState title="No team workload yet." />
            : <div className="table-wrap"><table className="data-table team-workload-table"><thead><tr><th>Member</th><th>Role</th><th>Assigned</th><th>Open reviews</th><th>Done today</th></tr></thead>
              <tbody>{data.workload.map((member) => <tr key={member.user_id}><td data-label="Member"><span className="cell-primary">{member.name}</span></td><td data-label="Role">{eventLabel(member.role)}</td><td data-label="Assigned" className="numeric">{member.assigned_alerts}</td><td data-label="Open reviews" className="numeric">{member.open_reviews}</td><td data-label="Done today" className="numeric">{member.completed_today}</td></tr>)}</tbody></table></div>}
        </Panel>
      </div>
      {(effectiveRole === 'ADMIN' || selectedTeam) && <section className="team-management-area" aria-labelledby="team-management-heading">
        <div className="section-heading"><h2 id="team-management-heading" className="section-title">Team management</h2><p className="section-description">Create teams and manage membership. Changes are recorded in the audit log.</p></div>
      {effectiveRole === 'ADMIN' && <details className="disclosure"><summary id="create-team-heading"><span className="disclosure-summary-copy">Create team<small>Add a new team with an active supervisor</small></span></summary><div className="disclosure-body">
        <div className="form-grid">
          <label className="field"><span className="field-label">Team name</span><input value={teamName} maxLength={120} onChange={(event) => setTeamName(event.target.value)} /></label>
          <label className="field"><span className="field-label">Supervisor</span><select value={supervisorId} onChange={(event) => setSupervisorId(event.target.value)}><option value="">Select a supervisor</option>
            {supervisors.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label>
          <div className="form-actions"><button type="button" className="btn btn-primary" disabled={saving || !teamName.trim() || !supervisorId}
            onClick={() => runManagementAction(async () => { const created = await teamService.createTeam(teamName.trim(), supervisorId); setTeamId(created.id); setTeamName(''); })}>Create team</button></div>
        </div>
      </div></details>}
      {selectedTeam && <details className="disclosure"><summary id="manage-team-heading"><span className="disclosure-summary-copy">Manage {selectedTeam.name}<small>Rename, change supervisor and manage auditors</small></span></summary><div className="disclosure-body team-manage-body">
        {effectiveRole === 'ADMIN' && <div className="form-grid">
          <label className="field"><span className="field-label">Team name</span><input value={teamNameEdit} maxLength={120} onChange={(event) => setTeamNameEdit(event.target.value)} /></label>
          <label className="field"><span className="field-label">Supervisor</span><select value={teamSupervisorEdit} onChange={(event) => setTeamSupervisorEdit(event.target.value)}>
            {supervisors.map((user) => <option value={user.id} key={user.id}>{user.name}</option>)}</select></label>
          <div className="form-actions"><button type="button" className="btn btn-secondary" disabled={saving || !teamNameEdit.trim() || !teamSupervisorEdit}
            onClick={() => runManagementAction(() => teamService.updateTeam(teamId, { name: teamNameEdit.trim(), supervisorId: teamSupervisorEdit }))}>Save team</button></div>
        </div>}
        <div className="form-grid"><label className="field"><span className="field-label">Add or transfer an auditor</span>
          <select value={memberId} onChange={(event) => setMemberId(event.target.value)}><option value="">Select an auditor</option>
            {candidates.filter((candidate) => candidate.team_id !== teamId).map((candidate) => <option value={candidate.id} key={candidate.id}>
              {candidate.name}{candidate.team_id ? ` (Transfer from ${teams.find((team) => team.id === candidate.team_id)?.name ?? 'another team'})` : ''}</option>)}
          </select></label>
          <div className="form-actions"><button type="button" className="btn btn-secondary" disabled={saving || !memberId} onClick={() => {
            const candidate = candidates.find((item) => item.id === memberId);
            runManagementAction(() => teamService.updateMember(teamId, memberId, candidate?.team_id ? 'TRANSFER' : 'ADD')).then(() => setMemberId(''));
          }}>Add auditor</button></div>
        </div>
        <div className="table-wrap team-member-table"><table className="data-table"><thead><tr><th>Team member</th><th>Role</th><th>Action</th></tr></thead><tbody>
          {data.workload.filter((member) => member.team_id === teamId && member.role === 'AUDITOR').map((member) => <tr key={member.user_id}><td data-label="Team member">{member.name}</td><td data-label="Role">{eventLabel(member.role)}</td>
            <td data-label="Action" className="cell-actions"><button type="button" className="btn btn-danger btn-sm" disabled={saving} onClick={() => runManagementAction(() => teamService.updateMember(teamId, member.user_id, 'REMOVE'))}>Remove</button></td></tr>)}
        </tbody></table></div>
      </div></details>}
      </section>}
    </div>
  );
}
