import { getRoleDefinition } from './roles.js';

export const EMPTY_PROFILE_FIELDS = Object.freeze({
  name: null,
  email: null,
  role: null,
  accountStatus: null,
  lastLoginAt: null,
  reviewsCompleted: null,
  alertsAssigned: null,
  lastReviewAt: null,
  failedSignInAttempts: null,
});

export function createProfileModel(user = null, previewRole = null) {
  const hasUser = Boolean(user && typeof user === 'object' && user.id);
  const fields = hasUser
    ? Object.freeze({ ...EMPTY_PROFILE_FIELDS, ...user })
    : EMPTY_PROFILE_FIELDS;

  return Object.freeze({
    hasIdentity: hasUser,
    fields,
    previewRole: hasUser ? null : getRoleDefinition(previewRole),
  });
}
