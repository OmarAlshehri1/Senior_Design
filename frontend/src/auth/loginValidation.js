const BASIC_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email) {
  const normalizedEmail = typeof email === 'string' ? email.trim() : '';
  if (!normalizedEmail) return 'Enter your email address.';
  if (!BASIC_EMAIL_PATTERN.test(normalizedEmail)) return 'Enter a valid email address.';
  return null;
}

export function validateLoginForm({ email, password } = {}) {
  const errors = {};
  const emailError = validateEmail(email);

  if (emailError) errors.email = emailError;
  if (typeof password !== 'string' || !password) errors.password = 'Enter your password.';

  return Object.freeze(errors);
}
