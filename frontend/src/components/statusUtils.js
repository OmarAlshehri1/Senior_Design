export function formatSAR(amount) {
  return formatAmount(amount, 'SAR');
}

export function formatAmount(amount, currency) {
  if (!Number.isFinite(amount)) return 'Not available';
  const formattedAmount = amount.toLocaleString('en-US');
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
  if (ruleStatus === 'Passed') return 'pill pill-passed';
  if (ruleStatus === 'Review') return 'pill pill-review';
  return 'pill pill-processing';
}

export function riskStatusPillClass(status) {
  if (status === 'High Risk') return 'pill pill-high';
  if (status === 'Medium Risk') return 'pill pill-medium';
  if (status === 'Low Risk') return 'pill pill-low';
  return 'pill pill-processing-status';
}

export function riskBadgeClass(status) {
  if (status === 'High Risk') return 'risk-badge badge-high';
  if (status === 'Medium Risk') return 'risk-badge badge-medium';
  if (status === 'Low Risk') return 'risk-badge badge-low';
  return 'risk-badge badge-neutral';
}
