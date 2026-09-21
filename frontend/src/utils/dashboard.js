import { deriveRiskDistribution, getRiskLevel } from './risk.js';
import { sortNewestFirst } from './transactions.js';

export const DASHBOARD_RISK_LINKS = Object.freeze({
  low: '/transactions?risk=low',
  medium: '/transactions?risk=medium',
  high: '/transactions?risk=high',
});

export function getRecentTransactions(transactions, limit = 6) {
  return sortNewestFirst(transactions).slice(0, limit);
}

export function deriveDashboardSummary(transactions) {
  const evaluated = transactions.filter(
    (transaction) => !transaction.processing && getRiskLevel(transaction.riskScore) !== null
  );
  const { counts, percentages } = deriveRiskDistribution(transactions);
  const riskScoreTotal = evaluated.reduce(
    (sum, transaction) => sum + transaction.riskScore,
    0
  );

  return {
    summary: {
      totalTransactions: transactions.length,
      transactionsEvaluated: evaluated.length,
      highRiskTransactions: counts.high,
      averageRiskScore: evaluated.length ? Math.round(riskScoreTotal / evaluated.length) : 0,
    },
    riskCounts: counts,
    riskOverview: percentages,
  };
}
