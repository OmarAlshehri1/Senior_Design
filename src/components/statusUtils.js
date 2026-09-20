export function formatSAR(amount) {
  return `${amount.toLocaleString('en-US')} SAR`;
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
  return 'risk-badge badge-low';
}
