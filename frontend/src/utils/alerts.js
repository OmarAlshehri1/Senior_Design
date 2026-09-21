import { getRiskLevel } from './risk.js';

export const ALERT_SORT_OPTIONS = Object.freeze({
  NEWEST: 'newest',
  OLDEST: 'oldest',
  HIGHEST_RISK: 'highest-risk',
  LOWEST_RISK: 'lowest-risk',
});

export const ALERT_TYPE_OPTIONS = Object.freeze([
  'Segregation of Duties',
  'Approval Limit',
  'Duplicate Payment',
  'Invoice Splitting',
  'Ghost Vendor',
]);

const fallbackReasons = Object.freeze({
  'Duplicate Payment': 'Possible duplicate payment detected for the same vendor and amount.',
  'Invoice Splitting': 'Related purchases may indicate an invoice-splitting pattern.',
  'Approval Limit': 'Transaction may exceed the configured approval limit.',
  'Segregation of Duties': 'Requester and approver may violate segregation-of-duties requirements.',
  'Ghost Vendor': 'Vendor may not match the registered vendor records.',
});

function normalizedText(value) {
  return value === null || value === undefined ? '' : String(value).trim().toLowerCase();
}

function timestampValue(alert) {
  const value = Date.parse(alert?.timestamp);
  return Number.isNaN(value) ? null : value;
}

function compareIds(a, b) {
  return normalizedText(a?.id).localeCompare(normalizedText(b?.id));
}

function compareTimestamps(a, b, direction) {
  const aTimestamp = timestampValue(a);
  const bTimestamp = timestampValue(b);

  if (aTimestamp === null && bTimestamp === null) return compareIds(a, b);
  if (aTimestamp === null) return 1;
  if (bTimestamp === null) return -1;

  const difference = direction === 'asc'
    ? aTimestamp - bTimestamp
    : bTimestamp - aTimestamp;
  return difference || compareIds(a, b);
}

function compareRisk(a, b, direction) {
  const aScore = Number.isFinite(a?.riskScore) ? a.riskScore : null;
  const bScore = Number.isFinite(b?.riskScore) ? b.riskScore : null;

  if (aScore === null && bScore === null) return compareTimestamps(a, b, 'desc');
  if (aScore === null) return 1;
  if (bScore === null) return -1;

  const difference = direction === 'asc' ? aScore - bScore : bScore - aScore;
  return difference || compareTimestamps(a, b, 'desc');
}

export function getAlertType(title) {
  const normalizedTitle = normalizedText(title);
  return ALERT_TYPE_OPTIONS.find((type) => normalizedTitle.includes(type.toLowerCase())) ?? null;
}

export function getAlertReason(alert) {
  const description = typeof alert?.description === 'string' ? alert.description.trim() : '';
  if (description) return description;

  return fallbackReasons[getAlertType(alert?.title)] ?? 'Alert reason not available.';
}

export function buildAlertRows(alerts, transactions) {
  const transactionsById = new Map(
    transactions.map((transaction) => [transaction?.id, transaction])
  );

  return alerts.map((alert) => {
    const transaction = transactionsById.get(alert?.transactionId);
    return {
      ...alert,
      alertType: getAlertType(alert?.title),
      reasonText: getAlertReason(alert),
      vendor: transaction?.vendor,
      amount: transaction?.amount,
      category: transaction?.category,
    };
  });
}

export function sortAlerts(alerts, sortBy = ALERT_SORT_OPTIONS.NEWEST) {
  const sorted = [...alerts];

  switch (sortBy) {
    case ALERT_SORT_OPTIONS.OLDEST:
      return sorted.sort((a, b) => compareTimestamps(a, b, 'asc'));
    case ALERT_SORT_OPTIONS.HIGHEST_RISK:
      return sorted.sort((a, b) => compareRisk(a, b, 'desc'));
    case ALERT_SORT_OPTIONS.LOWEST_RISK:
      return sorted.sort((a, b) => compareRisk(a, b, 'asc'));
    case ALERT_SORT_OPTIONS.NEWEST:
    default:
      return sorted.sort((a, b) => compareTimestamps(a, b, 'desc'));
  }
}

export function matchesAlertSearch(alert, search) {
  const query = normalizedText(search);
  if (!query) return true;

  return [alert?.id, alert?.transactionId, alert?.vendor, alert?.title, alert?.alertType]
    .some((value) => normalizedText(value).includes(query));
}

export function filterAndSortAlerts(alerts, transactions, options = {}) {
  const {
    search = '',
    statusFilter = 'All',
    riskFilter = 'All',
    typeFilter = 'All',
    sortBy = ALERT_SORT_OPTIONS.NEWEST,
  } = options;

  const filtered = buildAlertRows(alerts, transactions)
    .filter((alert) => matchesAlertSearch(alert, search))
    .filter((alert) => statusFilter === 'All' || alert?.status === statusFilter)
    .filter((alert) => (
      riskFilter === 'All'
      || getRiskLevel(alert?.riskScore) === `${riskFilter} Risk`
    ))
    .filter((alert) => typeFilter === 'All' || alert?.alertType === typeFilter);

  return sortAlerts(filtered, sortBy);
}

export function deriveAlertSummary(alerts) {
  return alerts.reduce((summary, alert) => {
    if (alert?.status === 'Active') summary.active += 1;
    if (alert?.status === 'Reviewed') summary.reviewed += 1;

    const riskLevel = getRiskLevel(alert?.riskScore);
    if (riskLevel === 'High Risk') summary.high += 1;
    if (riskLevel === 'Medium Risk') summary.medium += 1;
    return summary;
  }, { active: 0, reviewed: 0, high: 0, medium: 0 });
}

export function reviewAlertForTransaction(alerts, transactionId) {
  return alerts.map((alert) => (
    alert?.transactionId === transactionId && alert.status !== 'Reviewed'
      ? { ...alert, status: 'Reviewed' }
      : alert
  ));
}
