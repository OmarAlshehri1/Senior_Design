export const EVIDENCE_CATEGORIES = Object.freeze(['DOCUMENT', 'SCREENSHOT', 'INVOICE', 'APPROVAL_RECORD', 'OTHER']);
export const EVIDENCE_FIELDS = Object.freeze(['id', 'caseId', 'fileName', 'fileSize', 'mimeType', 'category', 'description', 'uploadedBy', 'uploadedAt', 'scanStatus']);
export const COMMENT_FIELDS = Object.freeze(['id', 'caseId', 'authorId', 'authorName', 'authorRole', 'message', 'createdAt']);

export function normalizeEvidence(value) {
  if (!value || typeof value !== 'object' || !EVIDENCE_CATEGORIES.includes(value.category)) return null;
  return Object.freeze(Object.fromEntries(EVIDENCE_FIELDS.map((field) => [field, value[field] ?? null])));
}

export function normalizeEvidenceCollection(values = []) {
  if (!Array.isArray(values)) return Object.freeze([]);
  return Object.freeze(values.map(normalizeEvidence).filter(Boolean));
}

export function normalizeComment(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.freeze(Object.fromEntries(COMMENT_FIELDS.map((field) => [field, value[field] ?? null])));
}

export function normalizeComments(values = []) {
  if (!Array.isArray(values)) return Object.freeze([]);
  return Object.freeze(values.map(normalizeComment).filter(Boolean));
}
