export const ACCESS_STATE_TYPES = Object.freeze({
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
});

export const ACCESS_STATE_PRESENTATION = Object.freeze({
  [ACCESS_STATE_TYPES.AUTHENTICATION_REQUIRED]: Object.freeze({
    statusCode: 401,
    title: 'Authentication Required',
    message: 'Sign in to continue.',
  }),
  [ACCESS_STATE_TYPES.PERMISSION_DENIED]: Object.freeze({
    statusCode: 403,
    title: 'Access Denied',
    message: 'You do not have permission to access this area.',
  }),
});

