import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import AuthFieldError from '../auth/AuthFieldError.jsx';
import AuthLayout from '../auth/AuthLayout.jsx';
import { ACCESS_REASON_MAX_LENGTH, validateAccessRequest } from '../auth/accessRequestValidation.js';
import { AUTH_ROUTES } from '../auth/authRoutes.js';
import { authService } from '../auth/authService.js';
import { normalizeAuthError } from '../auth/authErrors.js';

const EMPTY_REQUEST = Object.freeze({ fullName: '', email: '', department: '', employeeId: '', reason: '' });

export default function RequestAccess() {
  const formId = useId();
  const [values, setValues] = useState(EMPTY_REQUEST);
  const [fieldErrors, setFieldErrors] = useState({});
  const [serviceMessage, setServiceMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const updateField = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    if (fieldErrors[field]) setFieldErrors((current) => ({ ...current, [field]: undefined }));
    if (serviceMessage) setServiceMessage('');
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const errors = validateAccessRequest(values);
    setFieldErrors(errors);
    setServiceMessage('');
    if (Object.keys(errors).length > 0) return;
    setSubmitting(true);
    try {
      await authService.requestAccess({
        fullName: values.fullName.trim(), email: values.email.trim(), department: values.department.trim(),
        employeeId: values.employeeId.trim() || null, reason: values.reason.trim(),
      });
      setServiceMessage('Your request has been received for review.');
    } catch (error) {
      setServiceMessage(normalizeAuthError(error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const field = (name) => ({ id: `${formId}-${name}`, errorId: `${formId}-${name}-error` });
  const fullName = field('full-name');
  const email = field('email');
  const department = field('department');
  const employeeId = field('employee-id');
  const reason = field('reason');

  return (
    <AuthLayout panelClassName="auth-form-panel-wide">
      <header className="auth-form-header auth-form-header-compact">
        <p className="auth-form-eyebrow">Account access</p>
        <h2>Request access</h2>
        <p>Provide your work details for future administrator review.</p>
      </header>
      <form className="auth-form auth-request-form" onSubmit={handleSubmit} noValidate>
        {serviceMessage && <div className="auth-service-message auth-form-span" role="alert" aria-live="assertive">{serviceMessage}</div>}
        <div className="auth-field">
          <label htmlFor={fullName.id}>Full Name</label>
          <input id={fullName.id} autoComplete="name" value={values.fullName} aria-invalid={Boolean(fieldErrors.fullName)}
            aria-describedby={fieldErrors.fullName ? fullName.errorId : undefined} onChange={updateField('fullName')} />
          <AuthFieldError id={fullName.errorId}>{fieldErrors.fullName}</AuthFieldError>
        </div>
        <div className="auth-field">
          <label htmlFor={email.id}>Work Email</label>
          <input id={email.id} type="email" inputMode="email" autoComplete="email" value={values.email}
            aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? email.errorId : undefined} onChange={updateField('email')} />
          <AuthFieldError id={email.errorId}>{fieldErrors.email}</AuthFieldError>
        </div>
        <div className="auth-field">
          <label htmlFor={department.id}>Department</label>
          <input id={department.id} autoComplete="organization-title" value={values.department}
            aria-invalid={Boolean(fieldErrors.department)} aria-describedby={fieldErrors.department ? department.errorId : undefined} onChange={updateField('department')} />
          <AuthFieldError id={department.errorId}>{fieldErrors.department}</AuthFieldError>
        </div>
        <div className="auth-field">
          <label htmlFor={employeeId.id}>Employee ID <span className="auth-optional">— optional</span></label>
          <input id={employeeId.id} autoComplete="off" value={values.employeeId} onChange={updateField('employeeId')} />
        </div>
        <div className="auth-field auth-form-span">
          <label htmlFor={reason.id}>Reason for Access</label>
          <textarea id={reason.id} rows="3" maxLength={ACCESS_REASON_MAX_LENGTH + 1} value={values.reason}
            aria-invalid={Boolean(fieldErrors.reason)}
            aria-describedby={[fieldErrors.reason ? reason.errorId : null, `${reason.id}-limit`].filter(Boolean).join(' ')}
            onChange={updateField('reason')} />
          <div className="auth-field-meta">
            <AuthFieldError id={reason.errorId}>{fieldErrors.reason}</AuthFieldError>
            <span id={`${reason.id}-limit`}>{values.reason.length}/{ACCESS_REASON_MAX_LENGTH}</span>
          </div>
        </div>
        <p className="auth-approval-note auth-form-span">Access requires administrator approval. Roles are assigned during review.</p>
        <button className="auth-submit auth-form-span" type="submit" disabled={submitting}>Request access</button>
        <Link className="auth-text-action auth-form-span" to={AUTH_ROUTES.LOGIN}>Back to Sign In</Link>
      </form>
    </AuthLayout>
  );
}
