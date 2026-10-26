import { formatTimestamp, formatTime, getDateTimePresentation } from '../utils/dateTime.js';
import './dateTime.css';

export default function DateTime({ value, compact = false, timeOnly = false, utc = false, showZone = utc, seconds = false, className = '' }) {
  const parts = getDateTimePresentation(value, { utc });
  if (parts.kind !== 'date' && parts.kind !== 'timestamp') return <span className={className}>{parts.date}</span>;
  if (timeOnly && !parts.time) return <span className={className}>—</span>;
  const time = parts.time && (seconds ? parts.time : parts.time.slice(0, 5));
  const label = timeOnly ? (time ? `${time}${showZone ? ` (${parts.zone})` : ''}` : formatTime(value, { showZone, utc })) : formatTimestamp(value, { showZone, utc, seconds });
  return <time dateTime={value} title={formatTimestamp(value, { utc })} aria-label={formatTimestamp(value, { utc })} className={`${className}${compact ? ' date-time-compact' : ''}`}>
    {compact && parts.time && !timeOnly ? <><span>{parts.date}</span><span>{time}{showZone && ` (${parts.zone})`}</span></> : label}
  </time>;
}
