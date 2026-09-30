import { AUTH_ERROR_CODES, AuthError } from './authErrors.js';

function unavailable(code = AUTH_ERROR_CODES.AUTH_UNAVAILABLE) {
  return Promise.reject(new AuthError(code));
}

// Dormant boundary for the future authentication provider. No method creates a
// user, token, session, or successful response while authentication is absent.
export const authService = Object.freeze({
  signIn: unavailable,
  signOut: unavailable,
  getSession: unavailable,
  getCurrentUser: unavailable,
  requestAccess: () => unavailable(AUTH_ERROR_CODES.ACCESS_REQUESTS_UNAVAILABLE),
  requestPasswordReset: () => unavailable(AUTH_ERROR_CODES.PASSWORD_RESET_UNAVAILABLE),
});
