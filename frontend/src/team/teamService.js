import { apiClient } from '../services/apiClient.js';

export function createTeamService(client = apiClient) {
  return Object.freeze({
  getTeams: () => client.get('/teams'),
  getTeamActivity: (teamId = null) => client.get('/teams/activity', { query: { team_id: teamId } }),
  getMemberCandidates: (teamId) => client.get(`/teams/${encodeURIComponent(teamId)}/member-candidates`),
  createTeam: (name, supervisorId) => client.post('/teams', { name, supervisor_id: supervisorId }),
  updateTeam: (teamId, values = {}) => client.patch(`/teams/${encodeURIComponent(teamId)}`, {
    name: values.name, supervisor_id: values.supervisorId,
  }),
  deactivateTeam: (teamId) => client.delete(`/teams/${encodeURIComponent(teamId)}`),
  updateMember: (teamId, userId, action) => client.post(`/teams/${encodeURIComponent(teamId)}/members`, {
    user_id: userId, action,
  }),
  });
}

export const teamService = createTeamService();

