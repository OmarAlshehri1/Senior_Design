export function formatAmount(amount, currency) {
  if (!Number.isFinite(amount)) return 'Not available';
  const formattedAmount = amount.toLocaleString('en-US', { maximumFractionDigits: 20 });
  const formattedCurrency = displayValue(currency, '');
  return formattedCurrency ? `${formattedAmount} ${formattedCurrency}` : formattedAmount;
}

export function displayValue(value, fallback = 'Not available') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string' && value.trim() === '') return fallback;
  return value;
}

export function formatScore(score) {
  return Number.isFinite(score) ? `${score}/100` : 'Not available';
}

export function ruleStatusPillClass(ruleStatus) {
  if (ruleStatus === 'Passed') return 'badge badge-low';
  if (ruleStatus === 'Review') return 'badge badge-medium';
  return 'badge badge-neutral';
}

export function riskTone(status) {
  if (status === 'High Risk') return 'high';
  if (status === 'Medium Risk') return 'medium';
  if (status === 'Low Risk') return 'low';
  return 'neutral';
}

export function riskStatusPillClass(status) {
  return `badge badge-${riskTone(status)} badge-risk`;
}

export function riskBadgeClass(status) {
  return riskStatusPillClass(status);
}

// Presentation tones for recorded workflow states; labels always accompany color.
export const WORKFLOW_TONES = Object.freeze({ blue: 'info', amber: 'medium', red: 'high', purple: 'violet', green: 'low', slate: 'neutral' });
export const SLA_TONES = Object.freeze({ complete: 'low', overdue: 'high', 'due-soon': 'medium', 'on-track': 'neutral', neutral: 'neutral' });
export const MONITORING_TONES = Object.freeze({ NORMAL: 'neutral', WATCHLISTED: 'medium', BLOCKED: 'high' });
export const PRIORITY_TONES = Object.freeze({ LOW: 'neutral', MEDIUM: 'medium', HIGH: 'high', CRITICAL: 'high' });

export function titleCase(value) {
  if (typeof value !== 'string' || !value) return '—';
  return value.toLowerCase().split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}
