import { shortReference } from '../utils/presentation.js';

export default function Reference({ value, label }) {
  if (!value) return <span>—</span>;
  return <details className="display-reference" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <summary title={value}>{label ?? shortReference(value)}</summary>
    <span className="reference-full">{value}</span>
  </details>;
}
