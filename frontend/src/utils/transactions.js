import { getRiskLevel } from './risk.js';

export const TRANSACTION_SORT_OPTIONS = Object.freeze({
  NEWEST: 'newest',
  OLDEST: 'oldest',
  HIGHEST_RISK: 'highest-risk',
  LOWEST_RISK: 'lowest-risk',
  HIGHEST_AMOUNT: 'highest-amount',
  LOWEST_AMOUNT: 'lowest-amount',
});

export const AUDIT_RULE_DEFINITIONS = Object.freeze([
  { key: 'segregationOfDuties', label: 'Segregation of Duties' },
  { key: 'approvalLimit', label: 'Approval Limits' },
  { key: 'duplicatePayment', label: 'Duplicate Payments' },
  { key: 'invoiceSplitting', label: 'Invoice Splitting' },
  { key: 'ghostVendor', label: 'Ghost Vendors' },
]);

const riskFilters = ['All', 'Low', 'Medium', 'High'];

function timestampValue(item) {
  const value = Date.parse(item?.timestamp);
  return Number.isNaN(value) ? null : value;
}

function normalizedText(value) {
  return value === null || value === undefined ? '' : String(value).trim().toLowerCase();
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

function compareNumbers(a, b, key, direction) {
  const aValue = Number.isFinite(a?.[key]) ? a[key] : null;
  const bValue = Number.isFinite(b?.[key]) ? b[key] : null;

  if (aValue === null && bValue === null) return compareTimestamps(a, b, 'desc');
  if (aValue === null) return 1;
  if (bValue === null) return -1;

  const difference = direction === 'asc' ? aValue - bValue : bValue - aValue;
  return difference || compareTimestamps(a, b, 'desc');
}

export function sortTransactions(transactions, sortBy = TRANSACTION_SORT_OPTIONS.NEWEST) {
  const sorted = [...transactions];

  switch (sortBy) {
    case TRANSACTION_SORT_OPTIONS.OLDEST:
      return sorted.sort((a, b) => compareTimestamps(a, b, 'asc'));
    case TRANSACTION_SORT_OPTIONS.HIGHEST_RISK:
      return sorted.sort((a, b) => compareNumbers(a, b, 'riskScore', 'desc'));
    case TRANSACTION_SORT_OPTIONS.LOWEST_RISK:
      return sorted.sort((a, b) => compareNumbers(a, b, 'riskScore', 'asc'));
    case TRANSACTION_SORT_OPTIONS.HIGHEST_AMOUNT:
      return sorted.sort((a, b) => compareNumbers(a, b, 'amount', 'desc'));
    case TRANSACTION_SORT_OPTIONS.LOWEST_AMOUNT:
      return sorted.sort((a, b) => compareNumbers(a, b, 'amount', 'asc'));
    case TRANSACTION_SORT_OPTIONS.NEWEST:
    default:
      return sorted.sort((a, b) => compareTimestamps(a, b, 'desc'));
  }
}

export function sortNewestFirst(items) {
  return sortTransactions(items, TRANSACTION_SORT_OPTIONS.NEWEST);
}

export function getRiskFilterFromQuery(value) {
  const requestedRisk = normalizedText(value);
  if (!requestedRisk) return 'All';

  const normalizedRisk = `${requestedRisk[0].toUpperCase()}${requestedRisk.slice(1)}`;
  return riskFilters.includes(normalizedRisk) ? normalizedRisk : 'All';
}

export function matchesTransactionSearch(transaction, search) {
  const query = normalizedText(search);
  if (!query) return true;

  return [transaction?.id, transaction?.vendor, transaction?.category]
    .some((value) => normalizedText(value).includes(query));
}

export function filterAndSortTransactions(transactions, options = {}) {
  const {
    search = '',
    riskFilter = 'All',
    ruleFilter = 'All',
    sortBy = TRANSACTION_SORT_OPTIONS.NEWEST,
  } = options;

  const filtered = transactions
    .filter((transaction) => !transaction?.processing)
    .filter((transaction) => matchesTransactionSearch(transaction, search))
    .filter((transaction) => (
      riskFilter === 'All'
      || getRiskLevel(transaction?.riskScore) === `${riskFilter} Risk`
    ))
    .filter((transaction) => (
      ruleFilter === 'All' || transaction?.ruleStatus === ruleFilter
    ));

  return sortTransactions(filtered, sortBy);
}

export function findTransactionById(transactions, id) {
  return transactions.find((transaction) => transaction?.id === id) ?? null;
}

function isMissing(value) {
  return value === null
    || value === undefined
    || (typeof value === 'string' && value.trim() === '');
}

export function getTransactionDataQuality(transaction) {
  if (!transaction) return { status: 'Needs Review', missingFields: ['Transaction'] };

  const fieldGroups = {
    critical: [
      ['id', 'Transaction ID'],
      ['vendor', 'Vendor'],
      ['amount', 'Amount'],
      ['riskScore', 'Risk Score'],
    ],
    supporting: [
      ['category', 'Category'],
      ['date', 'Date'],
      ['time', 'Time'],
      ['ruleScore', 'Rule Score'],
      ['aiScore', 'AI Score'],
      ['rules', 'Audit Rule Results'],
    ],
  };

  const missingCritical = fieldGroups.critical
    .filter(([key]) => isMissing(transaction[key]))
    .map(([, label]) => label);
  const missingSupporting = fieldGroups.supporting
    .filter(([key]) => isMissing(transaction[key]))
    .map(([, label]) => label);
  const missingFields = [...missingCritical, ...missingSupporting];

  if (transaction.dataQuality?.status) {
    return {
      status: transaction.dataQuality.status,
      missingFields: transaction.dataQuality.missingFields ?? missingFields,
    };
  }
  if (missingCritical.length > 0) return { status: 'Needs Review', missingFields };
  if (missingSupporting.length > 0) return { status: 'Partially Complete', missingFields };
  return { status: 'Complete', missingFields: [] };
}
