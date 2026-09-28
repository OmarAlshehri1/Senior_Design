import { AUDIT_RULES } from '../data/auditRules.js';
import { deriveAlertSummary } from './alerts.js';
import { deriveDashboardSummary } from './dashboard.js';
import { getRiskLevel, RISK_LEVELS } from './risk.js';
import { sortNewestFirst } from './transactions.js';

function getPreviewDate(transactions) {
  const newestWithTimestamp = sortNewestFirst(transactions)
    .find((transaction) => !Number.isNaN(Date.parse(transaction?.timestamp)));

  return newestWithTimestamp?.timestamp ?? null;
}

export function deriveRuleViolationSummary(transactions) {
  const evaluatedTransactions = transactions.filter((transaction) => !transaction?.processing);

  return AUDIT_RULES.map(({ id, key, name }) => ({
    id,
    key,
    name,
    violationCount: evaluatedTransactions.reduce(
      (count, transaction) => count + (transaction?.rules?.[key]?.status === 'Failed' ? 1 : 0),
      0
    ),
  }));
}

export function deriveHighRiskTransactions(transactions) {
  return sortNewestFirst(
    transactions.filter((transaction) => (
      !transaction?.processing
      && getRiskLevel(transaction?.riskScore) === RISK_LEVELS.HIGH
    ))
  );
}

export function deriveReportPreview(transactions = [], alerts = []) {
  const { summary, riskCounts, riskOverview } = deriveDashboardSummary(transactions);
  const alertCounts = deriveAlertSummary(alerts);

  return {
    dailySummary: {
      ...summary,
      activeAlerts: alertCounts.active,
      reviewedAlerts: alertCounts.reviewed,
    },
    riskDistribution: [
      { key: 'low', label: RISK_LEVELS.LOW, count: riskCounts.low, percentage: riskOverview.low },
      { key: 'medium', label: RISK_LEVELS.MEDIUM, count: riskCounts.medium, percentage: riskOverview.medium },
      { key: 'high', label: RISK_LEVELS.HIGH, count: riskCounts.high, percentage: riskOverview.high },
    ],
    ruleSummary: deriveRuleViolationSummary(transactions),
    highRiskTransactions: deriveHighRiskTransactions(transactions),
    alertSummary: {
      total: alerts.length,
      active: alertCounts.active,
      reviewed: alertCounts.reviewed,
      high: alertCounts.high,
      medium: alertCounts.medium,
    },
    previewDate: getPreviewDate(transactions),
  };
}
