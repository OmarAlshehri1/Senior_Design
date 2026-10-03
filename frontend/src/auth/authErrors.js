export const AUTH_ERROR_CODES = Object.freeze({
  AUTH_UNAVAILABLE: 'AUTH_UNAVAILABLE',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  ACCESS_REQUESTS_UNAVAILABLE: 'ACCESS_REQUESTS_UNAVAILABLE',
  PASSWORD_RESET_UNAVAILABLE: 'PASSWORD_RESET_UNAVAILABLE',
});

export const AUTH_ERROR_MESSAGES = Object.freeze({
  [AUTH_ERROR_CODES.AUTH_UNAVAILABLE]: 'Sign-in service is not available yet.',
  [AUTH_ERROR_CODES.INVALID_CREDENTIALS]: 'The email or password is incorrect.',
  [AUTH_ERROR_CODES.ACCOUNT_LOCKED]: 'Your account is locked. Request an unlock from the sign-in page for administrator review.',
  [AUTH_ERROR_CODES.ACCOUNT_DISABLED]: 'This account is currently unavailable. Contact an administrator.',
  [AUTH_ERROR_CODES.SESSION_EXPIRED]: 'Your session has expired. Sign in again.',
  [AUTH_ERROR_CODES.FORBIDDEN]: 'You do not have permission to complete this action.',
  [AUTH_ERROR_CODES.ACCESS_REQUESTS_UNAVAILABLE]: 'Access requests are not available yet.',
  [AUTH_ERROR_CODES.PASSWORD_RESET_UNAVAILABLE]: 'Password reset is not available yet.',
});

export class AuthError extends Error {
  constructor(code = AUTH_ERROR_CODES.AUTH_UNAVAILABLE, options = {}) {
    const safeCode = AUTH_ERROR_MESSAGES[code] ? code : AUTH_ERROR_CODES.AUTH_UNAVAILABLE;
    super(AUTH_ERROR_MESSAGES[safeCode]);
    this.name = 'AuthError';
    this.code = safeCode;
    if (options.cause) this.cause = options.cause;
  }
}

export function normalizeAuthError(error) {
  if (error instanceof AuthError) return error;
  return new AuthError(AUTH_ERROR_CODES.AUTH_UNAVAILABLE, { cause: error });
}
