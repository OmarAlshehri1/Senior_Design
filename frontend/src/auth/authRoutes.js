export const AUTH_ROUTES = Object.freeze({
  LOGIN: '/login',
  REQUEST_ACCESS: '/request-access',
  FORGOT_PASSWORD: '/forgot-password',
  PASSWORD_RECOVERY: '/auth/callback',
  ACCESS_PENDING: '/access-pending',
  ACCOUNT_LOCKED: '/account-locked',
  ACCOUNT_DISABLED: '/account-disabled',
  SESSION_EXPIRED: '/session-expired',
  SUPPORT: '/support',
  PRIVACY_SECURITY: '/privacy-security',
});

export const STANDALONE_AUTH_PATHS = Object.freeze(Object.values(AUTH_ROUTES));
