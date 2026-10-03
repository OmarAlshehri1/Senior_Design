export const RISK_LEVELS = {
  LOW: 'Low Risk',
  MEDIUM: 'Medium Risk',
  HIGH: 'High Risk',
};

export const RISK_THRESHOLDS = Object.freeze({
  LOW: Object.freeze({ label: RISK_LEVELS.LOW, min: 0, max: 49 }),
  MEDIUM: Object.freeze({ label: RISK_LEVELS.MEDIUM, min: 50, max: 74 }),
  HIGH: Object.freeze({ label: RISK_LEVELS.HIGH, min: 75, max: 100 }),
});

// Temporary display classification for frontend mock data only.
// The backend will be authoritative after API integration.
export function getRiskLevel(riskScore) {
  if (
    !Number.isFinite(riskScore)
    || riskScore < RISK_THRESHOLDS.LOW.min
    || riskScore > RISK_THRESHOLDS.HIGH.max
  ) return null;
  if (riskScore >= RISK_THRESHOLDS.HIGH.min) return RISK_LEVELS.HIGH;
  if (riskScore >= RISK_THRESHOLDS.MEDIUM.min) return RISK_LEVELS.MEDIUM;
  return RISK_LEVELS.LOW;
}

export function getTransactionRiskLevel(transaction) {
  const authoritativeLevel = transaction?.riskLevel;

  if (Object.values(RISK_LEVELS).includes(authoritativeLevel)) {
    return authoritativeLevel;
  }

  return getRiskLevel(transaction?.riskScore);
}

export function deriveRiskDistribution(transactions) {
  const evaluated = transactions
    .filter((transaction) => !transaction.processing)
    .map((transaction) => ({
      transaction,
      riskLevel: getTransactionRiskLevel(transaction),
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
