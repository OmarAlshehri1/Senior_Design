import Reference from './Reference.jsx';
import { transactionReference } from '../utils/presentation.js';

// Short display reference; the full stored ID stays in the tooltip and disclosure.
export default function TransactionReference({ value, className = 'reference-text truncate' }) {
  if (!value) return <span>—</span>;
  const label = transactionReference(value);
  if (label === value) return <span className={className} title={value}>{value}</span>;
  return <Reference value={value} label={label} />;
}
