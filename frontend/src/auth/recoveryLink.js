// Capture before the URL fragment is cleared; share one verification across effect reattachments.
export function createRecoveryVerifier(hash, service) {
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');
  const flow = fragment.get('type');
  const unlock = ['magiclink', 'email'].includes(flow);
  const valid = Boolean(accessToken && (unlock || (['recovery', 'invite'].includes(flow) && refreshToken)));
  let verification;
  return {
    valid, unlock,
    verify() {
      if (!valid) return Promise.reject(new Error('INVALID_RECOVERY_LINK'));
      if (!verification) verification = Promise.resolve().then(() => unlock
        ? service.confirmAccountUnlock(accessToken) : service.exchange(accessToken, refreshToken));
      return verification;
    },
  };
}
