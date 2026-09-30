export const EMPTY_TEAM_OVERVIEW = Object.freeze({
  teamMembers: null,
  activeAssignments: null,
  reviewsToday: null,
  openAlerts: null,
});

export function createTeamActivityModel({ activity = [], workload = [] } = {}) {
  return Object.freeze({
    overview: EMPTY_TEAM_OVERVIEW,
    activity: Object.freeze(Array.isArray(activity) ? [...activity] : []),
    workload: Object.freeze(Array.isArray(workload) ? [...workload] : []),
  });
}

