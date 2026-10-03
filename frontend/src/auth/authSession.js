const STORAGE_KEY = 'm004.auth.session.v1';
const listeners = new Set();
let volatileSession = null;

function browserStorage() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function readAuthSession(storage = browserStorage()) {
  if (!storage) return volatileSession;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return volatileSession;
    const value = JSON.parse(raw);
    return value && typeof value.access_token === 'string'
      && typeof value.refresh_token === 'string' ? value : volatileSession;
  } catch {
    return volatileSession;
  }
}

export function getAccessToken() {
  return readAuthSession()?.access_token ?? null;
}

export function saveAuthSession(session, storage = browserStorage()) {
  if (!session || typeof session.access_token !== 'string' || typeof session.refresh_token !== 'string') {
    throw new TypeError('Invalid authentication session.');
  }
  volatileSession = session;
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(session)); } catch { /* Keep this tab's session in memory. */ }
  listeners.forEach((listener) => listener(session));
  return session;
}

export function clearAuthSession(storage = browserStorage()) {
  volatileSession = null;
  try { storage?.removeItem(STORAGE_KEY); } catch { /* The in-memory session is still cleared. */ }
  listeners.forEach((listener) => listener(null));
}

export function onAuthSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
