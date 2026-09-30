import { validateEmail } from './loginValidation.js';

export const ACCESS_REASON_MAX_LENGTH = 500;

export function validateAccessRequest(values = {}) {
  const errors = {};
  const fullName = typeof values.fullName === 'string' ? values.fullName.trim() : '';
  const department = typeof values.department === 'string' ? values.department.trim() : '';
  const reason = typeof values.reason === 'string' ? values.reason.trim() : '';
  const emailError = validateEmail(values.email);

  if (!fullName) errors.fullName = 'Enter your full name.';
  if (emailError) errors.email = emailError;
  if (!department) errors.department = 'Enter your department.';
  if (!reason) errors.reason = 'Explain why you need access.';
  if (reason.length > ACCESS_REASON_MAX_LENGTH) {
    errors.reason = `Keep the reason to ${ACCESS_REASON_MAX_LENGTH} characters or fewer.`;
  }

  return Object.freeze(errors);
}
