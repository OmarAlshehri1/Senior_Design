import { apiClient } from '../services/apiClient.js';
import { AUTH_ERROR_CODES, AuthError } from './authErrors.js';
import { clearAuthSession, readAuthSession, saveAuthSession } from './authSession.js';

const AUTH_CODE_SET = new Set(Object.values(AUTH_ERROR_CODES));

function browserStorage() {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

function authError(error, fallback = AUTH_ERROR_CODES.AUTH_UNAVAILABLE) {
  if (error instanceof AuthError) return error;
  const code = AUTH_CODE_SET.has(error?.code) ? error.code
    : error?.status === 401 ? AUTH_ERROR_CODES.INVALID_CREDENTIALS
      : error?.status === 403 ? AUTH_ERROR_CODES.FORBIDDEN
        : fallback;
  return new AuthError(code, { cause: error });
}

export function createAuthService({ client = apiClient, storage = browserStorage() } = {}) {
  const getStoredSession = () => readAuthSession(storage);
  const remember = (session) => saveAuthSession(session, storage);
  const clear = () => clearAuthSession(storage);

  async function refresh(session) {
    const result = await client.post('/auth/refresh', {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    remember(result);
    return result;
  }

  async function getCurrentUser() {
    return client.get('/auth/me');
  }

  async function restoreSession() {
    const session = getStoredSession();
    if (!session) return null;
    try {
      let user;
      try {
        user = await getCurrentUser();
      } catch (error) {
        if (error?.status !== 401 || !session.refresh_token) throw error;
        await refresh(session);
        user = await getCurrentUser();
      }
      remember({ ...getStoredSession(), user });
      return user;
    } catch (error) {
      if ([401, 403].includes(error?.status)) clear();
      throw authError(error, error?.status === 401
        ? AUTH_ERROR_CODES.SESSION_EXPIRED : AUTH_ERROR_CODES.AUTH_UNAVAILABLE);
    }
  }

  return Object.freeze({
    async signIn(email, password) {
      try {
        const session = await client.post('/auth/login', { email, password });
        remember(session);
        return session.user;
      } catch (error) {
        throw authError(error, AUTH_ERROR_CODES.INVALID_CREDENTIALS);
      }
    },
    async signOut() {
      try {
        await client.post('/auth/logout', {});
      } catch (error) {
        // A server-side revocation may already have occurred; local credentials
        // must still be removed even when the provider cannot be reached.
        clear();
        throw authError(error);
      }
      clear();
    },
    async exchange(accessToken, refreshToken) {
      try {
        const session = await client.post('/auth/exchange', {
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        remember(session);
        return session.user;
      } catch (error) {
        throw authError(error, AUTH_ERROR_CODES.SESSION_EXPIRED);
      }
    },
    async updatePassword(password) {
      try {
        await client.post('/auth/password', { password });
        clear();
      } catch (error) {
        throw authError(error, AUTH_ERROR_CODES.SESSION_EXPIRED);
      }
    },
    getSession: getStoredSession,
    restoreSession,
    getCurrentUser,
    async refreshCurrentUser() {
      const session = getStoredSession();
      if (!session) throw new AuthError(AUTH_ERROR_CODES.SESSION_EXPIRED);
      try {
        await refresh(session);
        const user = await getCurrentUser();
        remember({ ...getStoredSession(), user });
        return user;
      } catch (error) {
        clear();
        throw authError(error, AUTH_ERROR_CODES.SESSION_EXPIRED);
      }
    },
    async requestAccess(request) {
      try {
        return await client.post('/access-requests', request);
      } catch (error) {
        throw authError(error, AUTH_ERROR_CODES.ACCESS_REQUESTS_UNAVAILABLE);
      }
    },
    async requestPasswordReset(email) {
      try {
        return await client.post('/auth/password-reset', { email });
      } catch (error) {
        throw authError(error, AUTH_ERROR_CODES.PASSWORD_RESET_UNAVAILABLE);
      }
    },
    async requestAccountUnlock(email) {
      try {
        return await client.post('/auth/unlock-request', { email });
      } catch (error) {
        throw authError(error, AUTH_ERROR_CODES.AUTH_UNAVAILABLE);
      }
    },
    async confirmAccountUnlock(accessToken) {
      try {
        return await client.post('/auth/unlock-request/confirm', { access_token: accessToken });
      } catch (error) {
        throw authError(error, AUTH_ERROR_CODES.SESSION_EXPIRED);
      }
    },
  });
}

export const authService = createAuthService();
