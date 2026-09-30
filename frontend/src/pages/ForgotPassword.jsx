import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import AuthFieldError from '../auth/AuthFieldError.jsx';
import AuthLayout from '../auth/AuthLayout.jsx';
import { AUTH_ROUTES } from '../auth/authRoutes.js';
import { authService } from '../auth/authService.js';
import { normalizeAuthError } from '../auth/authErrors.js';
import { validateEmail } from '../auth/loginValidation.js';

export default function ForgotPassword() {
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [serviceMessage, setServiceMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const emailErrorId = `${emailId}-error`;

  const handleSubmit = async (event) => {
    event.preventDefault();
    const error = validateEmail(email);
    setEmailError(error ?? '');
    setServiceMessage('');
    if (error) return;
    setSubmitting(true);
    try {
      await authService.requestPasswordReset(email.trim());
    } catch (requestError) {
      setServiceMessage(normalizeAuthError(requestError).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <header className="auth-form-header">
        <p className="auth-form-eyebrow">Account recovery</p>
        <h2>Forgot your password?</h2>
        <p>Enter your work email to request password reset instructions.</p>
      </header>
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {serviceMessage && <div className="auth-service-message" role="alert" aria-live="assertive">{serviceMessage}</div>}
        <div className="auth-field">
          <label htmlFor={emailId}>Email</label>
          <input id={emailId} type="email" inputMode="email" autoComplete="email" value={email}
            aria-invalid={Boolean(emailError)} aria-describedby={emailError ? emailErrorId : undefined}
            onChange={(event) => { setEmail(event.target.value); if (emailError) setEmailError(''); if (serviceMessage) setServiceMessage(''); }} />
          <AuthFieldError id={emailErrorId}>{emailError}</AuthFieldError>
        </div>
        <button className="auth-submit" type="submit" disabled={submitting}>Send Reset Instructions</button>
        <Link className="auth-text-action" to={AUTH_ROUTES.LOGIN}>Back to Sign In</Link>
      </form>
    </AuthLayout>
  );
}
