export default function AuthFieldError({ id, children }) {
  if (!children) return null;
  return <span className="auth-field-error" id={id}>{children}</span>;
}
