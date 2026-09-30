import { ROLE_DEFINITIONS, ROLE_KEYS } from './roles.js';

export const ROLE_PREVIEW_OPTIONS = Object.freeze(Object.values(ROLE_KEYS).map((role) => Object.freeze({
  value: role,
  label: ROLE_DEFINITIONS[role].displayName,
})));

export function createRolePreviewConfiguration(enabled = false) {
  return Object.freeze({
    enabled: enabled === true,
    persistent: false,
    storage: null,
    options: enabled === true ? ROLE_PREVIEW_OPTIONS : Object.freeze([]),
  });
}
