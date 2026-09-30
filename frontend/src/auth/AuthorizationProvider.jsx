import { useCallback, useMemo, useState } from 'react';
import AuthorizationContext from './authorizationStore.js';
import { createRolePreviewConfiguration } from './rolePreview.js';
import { ROLE_KEYS, hasPermission } from './roles.js';

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

  const setPreviewRole = useCallback((role) => {
    if (!previewConfig.enabled) return;
    const nextRole = Object.values(ROLE_KEYS).includes(role) ? role : null;
    setPreviewRoleState(nextRole);
  }, [previewConfig.enabled]);

  const mode = authenticatedUser
    ? AUTHORIZATION_MODES.AUTHENTICATED
    : previewConfig.enabled && previewRole
      ? AUTHORIZATION_MODES.ROLE_PREVIEW
      : AUTHORIZATION_MODES.UNCONNECTED;
  const effectiveRole = authenticatedUser?.role ?? (mode === AUTHORIZATION_MODES.ROLE_PREVIEW ? previewRole : null);

  const can = useCallback((permission) => {
    if (mode === AUTHORIZATION_MODES.UNCONNECTED) return true;
    return hasPermission(effectiveRole, permission);
  }, [effectiveRole, mode]);

  const value = useMemo(() => Object.freeze({
    mode,
    user: authenticatedUser,
    effectiveRole,
    previewRole,
    previewConfig,
    setPreviewRole,
    can,
  }), [authenticatedUser, can, effectiveRole, mode, previewConfig, previewRole, setPreviewRole]);

  return <AuthorizationContext.Provider value={value}>{children}</AuthorizationContext.Provider>;
}
