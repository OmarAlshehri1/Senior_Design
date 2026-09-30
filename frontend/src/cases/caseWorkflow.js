export const REVIEW_RESOLUTIONS = Object.freeze({
  NO_ISSUE_FOUND: 'NO_ISSUE_FOUND',
  ISSUE_CONFIRMED: 'ISSUE_CONFIRMED',
  FALSE_POSITIVE: 'FALSE_POSITIVE',
  NEEDS_INVESTIGATION: 'NEEDS_INVESTIGATION',
});

export const SLA_STATUSES = Object.freeze({ ON_TRACK: 'ON_TRACK', DUE_SOON: 'DUE_SOON', OVERDUE: 'OVERDUE', COMPLETED: 'COMPLETED' });

export function normalizeResolution(value) {
  if (!value || typeof value !== 'object' || !Object.values(REVIEW_RESOLUTIONS).includes(value.outcome)) return null;
  return Object.freeze({ outcome: value.outcome, note: value.note ?? null, resolvedBy: value.resolvedBy ?? null, resolvedAt: value.resolvedAt ?? null });
}

export function getSlaPresentation({ slaStatus, slaDueAt, completedAt, now = Date.now() } = {}) {
  if (!Object.values(SLA_STATUSES).includes(slaStatus) || !slaDueAt) return Object.freeze({ label: '—', tone: 'neutral' });
  const due = new Date(slaDueAt).getTime();
  if (!Number.isFinite(due)) return Object.freeze({ label: '—', tone: 'neutral' });
  if (slaStatus === SLA_STATUSES.COMPLETED) return Object.freeze({ label: completedAt && new Date(completedAt).getTime() <= due ? 'Completed on time' : 'Completed', tone: 'complete' });
  const delta = due - now;
  const minutes = Math.max(1, Math.round(Math.abs(delta) / 60000));
  const duration = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
  if (delta < 0 || slaStatus === SLA_STATUSES.OVERDUE) return Object.freeze({ label: `Overdue by ${duration}`, tone: 'overdue' });
  if (slaStatus === SLA_STATUSES.DUE_SOON) return Object.freeze({ label: `Due soon · ${duration}`, tone: 'due-soon' });
  return Object.freeze({ label: `Due in ${duration}`, tone: 'on-track' });
}
