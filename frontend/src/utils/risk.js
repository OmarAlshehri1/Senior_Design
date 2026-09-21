export const RISK_LEVELS = {
  LOW: 'Low Risk',
  MEDIUM: 'Medium Risk',
  HIGH: 'High Risk',
};

// Temporary display classification for frontend mock data only.
// The backend will be authoritative after API integration.
export function getRiskLevel(riskScore) {
  if (!Number.isFinite(riskScore) || riskScore < 0 || riskScore > 100) return null;
  if (riskScore >= 75) return RISK_LEVELS.HIGH;
  if (riskScore >= 50) return RISK_LEVELS.MEDIUM;
  return RISK_LEVELS.LOW;
}

export function deriveRiskDistribution(transactions) {
  const evaluated = transactions
    .filter((transaction) => !transaction.processing)
    .map((transaction) => ({
      transaction,
      riskLevel: getRiskLevel(transaction.riskScore),
    }))
    .filter(({ riskLevel }) => riskLevel !== null);

  const counts = { low: 0, medium: 0, high: 0 };
  evaluated.forEach(({ riskLevel }) => {
    if (riskLevel === RISK_LEVELS.HIGH) counts.high += 1;
    else if (riskLevel === RISK_LEVELS.MEDIUM) counts.medium += 1;
    else counts.low += 1;
  });

  if (evaluated.length === 0) {
    return { counts, percentages: { low: 0, medium: 0, high: 0 } };
  }

  const keys = ['low', 'medium', 'high'];
  const rawPercentages = Object.fromEntries(
    keys.map((key) => [key, (counts[key] / evaluated.length) * 100])
  );
  const percentages = Object.fromEntries(
    keys.map((key) => [key, Math.floor(rawPercentages[key])])
  );

  let remainder = 100 - keys.reduce((sum, key) => sum + percentages[key], 0);
  const byLargestFraction = [...keys].sort(
    (a, b) => (rawPercentages[b] - percentages[b]) - (rawPercentages[a] - percentages[a])
  );

  for (let index = 0; index < remainder; index += 1) {
    percentages[byLargestFraction[index]] += 1;
  }

  return { counts, percentages };
}
