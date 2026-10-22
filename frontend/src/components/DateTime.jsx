import { formatTimestamp, formatTime, getDateTimePresentation } from '../utils/dateTime.js';
import './dateTime.css';

export default function DateTime({ value, compact = false, showZone = true, timeOnly = false, utc = false, className = '' }) {
  const parts = getDateTimePresentation(value, { utc });
  if (parts.kind !== 'date' && parts.kind !== 'timestamp') return <span className={className}>{parts.date}</span>;
  if (timeOnly && !parts.time) return <span className={className}>—</span>;
  const label = timeOnly ? formatTime(value, { showZone, utc }) : formatTimestamp(value, { showZone, utc });
  return <time dateTime={value} aria-label={formatTimestamp(value, { utc })} className={`${className}${compact ? ' date-time-compact' : ''}`}>
    {compact && parts.time && !timeOnly ? <><span>{parts.date}</span><span>{parts.time}{showZone && ` (${parts.zone})`}</span></> : label}
  </time>;
}
