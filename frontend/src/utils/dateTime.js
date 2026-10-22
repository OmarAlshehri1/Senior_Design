export const DISPLAY_TIME_ZONE = 'Asia/Riyadh';
export const DISPLAY_TIME_ZONE_LABEL = 'UTC+3';
export const UNAVAILABLE_DATE = '—';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/;

function calendarParts(value) {
  if (typeof value !== 'string') return null;
  const match = DATE_ONLY.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    ? { year, month, day } : null;
}

// Calendar dates never enter Date or timezone conversion.
export function formatDateOnly(value) {
  const parts = calendarParts(value);
  return parts ? `${parts.day} ${MONTHS[parts.month - 1]} ${parts.year}` : UNAVAILABLE_DATE;
}

function classify(value) {
  if (calendarParts(value)) return { kind: 'date' };
  if (typeof value !== 'string') return { kind: 'unavailable' };
  const match = TIMESTAMP.exec(value);
  if (!match || !calendarParts(match[1]) || Number(match[2]) > 23
    || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59) return { kind: 'unavailable' };
  if (!match[5]) return { kind: 'unknown' };
  if (match[5] !== 'Z') {
    const [hours, minutes] = match[5].slice(1).split(':').map(Number);
    // RFC 3339 -00:00 explicitly means the local offset is unknown.
    if (hours > 23 || minutes > 59) return { kind: 'unavailable' };
    if (match[5] === '-00:00') return { kind: 'unknown' };
  }
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? { kind: 'unavailable' } : { kind: 'timestamp', instant };
}

const formatters = new Map();
function instantParts(instant, timeZone) {
  if (!formatters.has(timeZone)) formatters.set(timeZone, new Intl.DateTimeFormat('en-GB', {
    timeZone, day: 'numeric', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }));
  const parts = Object.fromEntries(formatters.get(timeZone).formatToParts(instant).map(({ type, value }) => [type, value]));
  return { date: `${parts.day} ${MONTHS[Number(parts.month) - 1]} ${parts.year}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

export function getDateTimePresentation(value, { utc = false } = {}) {
  const parsed = classify(value);
  if (parsed.kind === 'date') return { kind: 'date', date: formatDateOnly(value), time: null, zone: null };
  if (parsed.kind !== 'timestamp') return {
    kind: parsed.kind, date: parsed.kind === 'unknown' ? 'Unknown timezone' : UNAVAILABLE_DATE, time: null, zone: null,
  };
  return { kind: 'timestamp', ...instantParts(parsed.instant, utc ? 'UTC' : DISPLAY_TIME_ZONE),
    zone: utc ? 'UTC' : DISPLAY_TIME_ZONE_LABEL };
}

export function formatTimestamp(value, { utc = false, showZone = true } = {}) {
  const { date, time, zone } = getDateTimePresentation(value, { utc });
  return time ? `${date}, ${time}${showZone ? ` (${zone})` : ''}` : date;
}

export function formatDate(value) {
  return getDateTimePresentation(value).date;
}

export function formatTime(value, { showZone = true, utc = false } = {}) {
  const parts = getDateTimePresentation(value, { utc });
  if (!parts.time) return parts.kind === 'unknown' ? 'Unknown timezone' : UNAVAILABLE_DATE;
  return `${parts.time}${showZone ? ` (${parts.zone})` : ''}`;
}

export function formatUtcDate(value) {
  return getDateTimePresentation(value, { utc: true }).date;
}

export function formatUtcTimestamp(value) {
  return formatTimestamp(value, { utc: true, showZone: false });
}
