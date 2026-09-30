export class AuditServiceUnavailableError extends Error {
  constructor(message = 'Activity records are not available yet.') {
    super(message);
    this.name = 'AuditServiceUnavailableError';
  }
}

const unavailable = (message) => Promise.reject(new AuditServiceUnavailableError(message));

export const auditService = Object.freeze({
  getAuditEvents: () => unavailable('Audit activity is not available yet.'),
  getReviewHistory: () => unavailable('Review history is not available yet.'),
  addReviewNote: () => unavailable('Review notes are not available yet.'),
  getLoginHistory: () => unavailable('Sign-in history is not available yet.'),
  getSecurityActivity: () => unavailable('Security activity is not available yet.'),
});
