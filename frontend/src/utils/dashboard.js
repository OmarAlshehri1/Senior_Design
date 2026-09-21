import { deriveRiskDistribution, getRiskLevel } from './risk.js';

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
    riskOverview: percentages,
  };
}
