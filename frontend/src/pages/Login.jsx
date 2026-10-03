import { useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthFieldError from '../auth/AuthFieldError.jsx';
import AuthLayout from '../auth/AuthLayout.jsx';
import { AUTH_ROUTES } from '../auth/authRoutes.js';
import { authService } from '../auth/authService.js';
import { normalizeAuthError } from '../auth/authErrors.js';
import { validateLoginForm } from '../auth/loginValidation.js';

export default function Login() {
  const navigate = useNavigate();
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [serviceMessage, setServiceMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [unlockMessage, setUnlockMessage] = useState('');

  const resetFeedback = () => {
    setFieldErrors({});
    setServiceMessage('');
  };

  const handleSignIn = async (event) => {
    event.preventDefault();
    const errors = validateLoginForm({ email, password });
    setFieldErrors(errors);
    setServiceMessage('');
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await authService.signIn(email.trim(), password);
      navigate('/dashboard', { replace: true });
    } catch (error) {
      setServiceMessage(normalizeAuthError(error).message);
    } finally {
      setPassword('');
      setPasswordVisible(false);
      setSubmitting(false);
    }
  };

  const emailErrorId = `${emailId}-error`;
  const passwordErrorId = `${passwordId}-error`;

  const requestUnlock = async () => {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setUnlockMessage('Enter your email above to request an account unlock.');
      return;
    }
    try {
      const result = await authService.requestAccountUnlock(normalizedEmail);
      setUnlockMessage(result.message);
    } catch (error) {
      setUnlockMessage(normalizeAuthError(error).message);
    }
  };

  return (
    <AuthLayout>
      <header className="auth-form-header">
        <p className="auth-form-eyebrow">Secure access</p>
        <h2>Sign in to continue</h2>
        <p>Use your organization-provided account.</p>
      </header>
      <form className="auth-form" onSubmit={handleSignIn} noValidate>
        {serviceMessage && <div className="auth-service-message" role="alert" aria-live="assertive">{serviceMessage}</div>}
        <div className="auth-field">
          <label htmlFor={emailId}>Email</label>
          <input id={emailId} type="email" inputMode="email" autoComplete="email" value={email}
            aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? emailErrorId : undefined}
            onChange={(event) => { setEmail(event.target.value); if (fieldErrors.email || serviceMessage) resetFeedback(); }} />
          <AuthFieldError id={emailErrorId}>{fieldErrors.email}</AuthFieldError>
        </div>
        <div className="auth-field">
          <label htmlFor={passwordId}>Password</label>
          <span className="auth-password-control">
            <input id={passwordId} type={passwordVisible ? 'text' : 'password'} autoComplete="current-password" value={password}
              aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? passwordErrorId : undefined}
              onChange={(event) => { setPassword(event.target.value); if (fieldErrors.password || serviceMessage) resetFeedback(); }} />
            <button type="button" className="auth-password-toggle" aria-label={passwordVisible ? 'Hide password' : 'Show password'}
              aria-pressed={passwordVisible} onClick={() => setPasswordVisible((visible) => !visible)}>
              {passwordVisible ? 'Hide' : 'Show'}
            </button>
          </span>
          <AuthFieldError id={passwordErrorId}>{fieldErrors.password}</AuthFieldError>
        </div>
        <button className="auth-submit" type="submit" disabled={submitting}>Sign In</button>
        <Link className="auth-text-action" to={AUTH_ROUTES.FORGOT_PASSWORD}>Forgot password?</Link>
        <button className="auth-text-action" type="button" onClick={requestUnlock}>Request account unlock</button>
        {unlockMessage && <p role="status">{unlockMessage}</p>}
      </form>
      <section className="auth-account-entry" aria-labelledby="request-access-title">
        <div>
          <h3 id="request-access-title">New to the system?</h3>
          <p>Access requires administrator approval.</p>
        </div>
        <Link className="auth-secondary-action" to={AUTH_ROUTES.REQUEST_ACCESS}>Request access</Link>
      </section>
    </AuthLayout>
  );
}
