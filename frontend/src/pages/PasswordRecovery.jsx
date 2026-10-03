import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AuthLayout from '../auth/AuthLayout.jsx';
import { AUTH_ROUTES } from '../auth/authRoutes.js';
import { authService } from '../auth/authService.js';
import { normalizeAuthError } from '../auth/authErrors.js';

export default function PasswordRecovery() {
  const passwordId = useId();
  const confirmId = useId();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [unlockComplete, setUnlockComplete] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('Verifying your secure link…');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');
    const flow = fragment.get('type');
    window.history.replaceState(null, document.title, window.location.pathname);
    if (!accessToken || !['recovery', 'invite', 'magiclink', 'email'].includes(flow)) {
      setMessage('This link is invalid or has expired. Request a new secure link.');
      return () => { active = false; };
    }
    if (['magiclink', 'email'].includes(flow)) {
      authService.confirmAccountUnlock(accessToken)
        .then((result) => { if (active) { setUnlockComplete(true); setMessage(result.message); } })
        .catch((error) => { if (active) setMessage(normalizeAuthError(error).message); });
      return () => { active = false; };
    }
    if (!refreshToken) {
      setMessage('This link is invalid or has expired. Request a new secure link.');
      return () => { active = false; };
    }
    authService.exchange(accessToken, refreshToken)
      .then(() => { if (active) { setReady(true); setMessage('Choose a new password for your account.'); } })
      .catch((error) => { if (active) setMessage(normalizeAuthError(error).message); });
    return () => { active = false; };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 12) { setMessage('Use at least 12 characters for your new password.'); return; }
    if (password !== confirmation) { setMessage('The passwords do not match.'); return; }
    setSubmitting(true);
    setMessage('');
    try {
      await authService.updatePassword(password);
      navigate(AUTH_ROUTES.LOGIN, { replace: true, state: { passwordUpdated: true } });
    } catch (error) {
      setMessage(normalizeAuthError(error).message);
    } finally {
      setPassword('');
      setConfirmation('');
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout>
      <header className="auth-form-header">
        <p className="auth-form-eyebrow">Account recovery</p>
        <h2>Set a new password</h2>
        <p>Secure links are verified by the account service before a password can be changed.</p>
      </header>
      {message && <p className="auth-service-message" role="status" aria-live="polite">{message}</p>}
      {ready && (
        <form className="auth-form" onSubmit={submit}>
          <div className="auth-field"><label htmlFor={passwordId}>New password</label><input id={passwordId} type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} /></div>
          <div className="auth-field"><label htmlFor={confirmId}>Confirm new password</label><input id={confirmId} type="password" autoComplete="new-password" minLength={12} maxLength={1024} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></div>
          <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'Updating…' : 'Update password'}</button>
        </form>
      )}
      {unlockComplete && <Link className="auth-submit" to={AUTH_ROUTES.LOGIN}>Return to sign in</Link>}
      {!ready && !unlockComplete && <Link className="auth-text-action" to={AUTH_ROUTES.FORGOT_PASSWORD}>Request another secure link</Link>}
    </AuthLayout>
  );
}
