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
  return Object.freeze(Object.fromEntries(
    REVIEW_RECORD_FIELDS.map((field) => [field, record[field] ?? null])
  ));
}

export function normalizeReviewHistory(records = []) {
  if (!Array.isArray(records)) return Object.freeze([]);
  return Object.freeze(records.map(normalizeReviewRecord).filter(Boolean));
}

export function createReviewAccountability(history = []) {
  return Object.freeze({
    reviewedBy: null,
    reviewedAt: null,
    note: null,
    history: normalizeReviewHistory(history),
  });
}
