import { useCallback, useEffect, useMemo, useState } from 'react';
import AuthorizationContext from './authorizationStore.js';
import { createRolePreviewConfiguration } from './rolePreview.js';
import { ROLE_KEYS, hasPermission } from './roles.js';
import { authService } from './authService.js';
import { onAuthSessionChange } from './authSession.js';

export const AUTHORIZATION_MODES = Object.freeze({
  UNCONNECTED: 'UNCONNECTED',
  ROLE_PREVIEW: 'ROLE_PREVIEW',
  AUTHENTICATED: 'AUTHENTICATED',
});

export default function AuthorizationProvider({
  children,
  previewEnabled = false,
  authenticatedUser = null,
}) {
  const previewConfig = useMemo(
    () => createRolePreviewConfiguration(previewEnabled),
    [previewEnabled]
  );
  const [previewRole, setPreviewRoleState] = useState(null);
  const [restoredUser, setRestoredUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthSessionChange((session) => {
      if (active) setRestoredUser(session?.user ?? null);
    });
    authService.restoreSession()
      .then((user) => { if (active) setRestoredUser(user); })
      .catch(() => { if (active) setRestoredUser(null); })
      .finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; unsubscribe(); };
  }, []);

  const setPreviewRole = useCallback((role) => {
    if (!previewConfig.enabled) return;
    const nextRole = Object.values(ROLE_KEYS).includes(role) ? role : null;
    setPreviewRoleState(nextRole);
  }, [previewConfig.enabled]);

  const currentUser = authenticatedUser ?? restoredUser;
  const mode = currentUser
    ? AUTHORIZATION_MODES.AUTHENTICATED
    : previewConfig.enabled && previewRole
      ? AUTHORIZATION_MODES.ROLE_PREVIEW
      : AUTHORIZATION_MODES.UNCONNECTED;
  const effectiveRole = currentUser?.role ?? (mode === AUTHORIZATION_MODES.ROLE_PREVIEW ? previewRole : null);

  const can = useCallback((permission) => {
    if (mode === AUTHORIZATION_MODES.UNCONNECTED) return previewConfig.enabled;
    return hasPermission(effectiveRole, permission);
  }, [effectiveRole, mode]);

  const value = useMemo(() => Object.freeze({
    mode,
    user: currentUser,
    isLoading,
    authenticationRequired: !previewConfig.enabled,
    effectiveRole,
    previewRole,
    previewConfig,
    setPreviewRole,
    can,
  }), [can, currentUser, effectiveRole, isLoading, mode, previewConfig, previewRole, setPreviewRole]);

  return <AuthorizationContext.Provider value={value}>{children}</AuthorizationContext.Provider>;
}
