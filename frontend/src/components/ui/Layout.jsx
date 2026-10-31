import { Link } from 'react-router-dom';
import { ArrowLeftIcon } from '../icons.jsx';

export function PageHeader({ title, description, eyebrow, actions, back, children }) {
  return <header className="page-header">
    <div className="page-header-copy">
      {back && <Link className="back-link" to={back.to}><ArrowLeftIcon width={15} height={15} aria-hidden="true" />{back.label}</Link>}
      {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p className="page-description">{description}</p>}
      {children}
    </div>
    {actions && <div className="page-header-actions">{actions}</div>}
  </header>;
}

// One titled surface. Use flush for edge-to-edge tables and lists.
export function Panel({ id, title, description, actions, children, flush = false, className = '', headingLevel = 2, ...rest }) {
  const Heading = `h${headingLevel}`;
  return <section className={`panel${className ? ` ${className}` : ''}`} aria-labelledby={title ? id : undefined} {...rest}>
    {(title || actions) && <header className="panel-header">
      <div className="panel-heading">
        {title && <Heading id={id} className="panel-title">{title}</Heading>}
        {description && <p className="panel-description">{description}</p>}
      </div>
      {actions && <div className="panel-actions">{actions}</div>}
    </header>}
    <div className={flush ? 'panel-body-flush' : 'panel-body'}>{children}</div>
  </section>;
}

export function MetricStrip({ items, label, loading = false }) {
  return <dl className="metric-strip" aria-label={label} aria-busy={loading || undefined}>
    {items.map(({ label: itemLabel, value, hint, tone = 'neutral' }) => <div className={`metric tone-${tone}`} key={itemLabel}>
      <dt>{itemLabel}</dt>
      <dd>
        <span className="metric-value">{loading ? <span className="skeleton skeleton-value" aria-hidden="true" /> : (value ?? '—')}</span>
        {hint && !loading && <span className="metric-hint">{hint}</span>}
      </dd>
    </div>)}
  </dl>;
}

export function Badge({ tone = 'neutral', children, dot = false, className = '' }) {
  return <span className={`badge badge-${tone}${className ? ` ${className}` : ''}`}>{dot && <span className="badge-dot" aria-hidden="true" />}{children}</span>;
}

export function Field({ label, hint, children, className = '', htmlFor }) {
  return <label className={`field${className ? ` ${className}` : ''}`} htmlFor={htmlFor}>
    <span className="field-label">{label}</span>
    {children}
    {hint && <span className="field-hint">{hint}</span>}
  </label>;
}

export function Switch({ checked, onChange, label, description, disabled = false }) {
  return <label className="switch">
    <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
    <span className="switch-copy"><span className="switch-label">{label}</span>{description && <span className="switch-description">{description}</span>}</span>
  </label>;
}

export function KeyValueList({ items, columns = 2 }) {
  return <dl className={`key-values columns-${columns}`}>
    {items.filter(Boolean).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value ?? '—'}</dd></div>)}
  </dl>;
}
