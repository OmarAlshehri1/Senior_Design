export const REVIEW_ACTIONS = Object.freeze({
  REVIEWED: 'REVIEWED',
  REOPENED: 'REOPENED',
  NOTE_ADDED: 'NOTE_ADDED',
});

export const REVIEW_RECORD_FIELDS = Object.freeze([
  'id', 'transactionId', 'reviewerId', 'reviewerName', 'reviewerRole',
  'action', 'note', 'timestamp',
]);

export function normalizeReviewRecord(record) {
  if (!record || typeof record !== 'object') return null;
  if (!Object.values(REVIEW_ACTIONS).includes(record.action)) return null;
  const source = {
    ...record,
    transactionId: record.transactionId ?? record.transaction_id,
    resourceType: record.resourceType ?? record.resource_type,
    resourceId: record.resourceId ?? record.resource_id,
    reviewerId: record.reviewerId ?? record.actor_id,
    reviewerName: record.reviewerName ?? record.actor_name,
    reviewerRole: record.reviewerRole ?? record.actor_role,
    timestamp: record.timestamp ?? record.created_at,
  };
  return Object.freeze(Object.fromEntries(
    REVIEW_RECORD_FIELDS.map((field) => [field, source[field] ?? null])
  ));
}

export function normalizeReviewHistory(records = []) {
  if (!Array.isArray(records)) return Object.freeze([]);
  return Object.freeze(records.map(normalizeReviewRecord).filter(Boolean));
}

export function createReviewAccountability(history = []) {
  const records = normalizeReviewHistory(history);
  const stateChange = records.find((record) => ['REVIEWED', 'REOPENED'].includes(record.action));
  const note = records.find((record) => record.action === 'NOTE_ADDED' && record.note)?.note ?? null;
  const reviewed = stateChange?.action === 'REVIEWED' ? stateChange : null;
  return Object.freeze({
    reviewedBy: reviewed?.reviewerName ?? null,
    reviewedAt: reviewed?.timestamp ?? null,
    note,
    history: records,
  });
}
