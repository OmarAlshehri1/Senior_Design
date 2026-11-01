import { apiClient } from './apiClient.js';

export function adaptDashboardCategories(value) {
  if (!Array.isArray(value?.items) || !Number.isSafeInteger(value?.total_transactions)) {
    throw new Error('Category totals are unavailable.');
  }
  if (value.total_transactions < 0 || value.items.some((row) =>
    !row || !(row.category === null || (typeof row.category === 'string' && row.category.length > 0))
    || !Number.isSafeInteger(row.transactions) || row.transactions < 0
    || !Number.isSafeInteger(row.high_risk_transactions) || row.high_risk_transactions < 0
    || row.high_risk_transactions > row.transactions)
    || value.items.reduce((total, row) => total + row.transactions, 0) !== value.total_transactions) {
    throw new Error('Category totals are unavailable.');
  }
  return Object.freeze({
    totalTransactions: value.total_transactions,
    items: Object.freeze(value.items.map((row) => Object.freeze({
      key: JSON.stringify(row.category),
      name: row.category ?? 'Uncategorized',
      transactions: row.transactions,
      highRiskTransactions: row.high_risk_transactions,
    }))),
  });
}

export function dashboardCategoryFilter(key) {
  if (key === '') return {};
  const category = JSON.parse(key);
  return category === null ? { uncategorized: true } : { category };
}

export function adaptDashboardSummary(value) {
  const low = Number(value?.low_risk_transactions ?? 0);
  const medium = Number(value?.medium_risk_transactions ?? 0);
  const high = Number(value?.high_risk_transactions ?? 0);
  const evaluated = low + medium + high;
  if (evaluated === 0) return Object.freeze({
    summary: Object.freeze({ totalTransactions: Number(value?.total_transactions ?? 0), transactionsEvaluated: Number(value?.transactions_evaluated ?? 0), highRiskTransactions: high, averageRiskScore: Number(value?.average_risk_score ?? 0), activeAlerts: Number(value?.active_alerts ?? 0), generatedAt: value?.generated_at ?? null }),
    riskCounts: Object.freeze({ low, medium, high }), riskOverview: Object.freeze({ low: 0, medium: 0, high: 0 }),
  });
  const percent = (count) => evaluated ? Math.floor((count / evaluated) * 100) : 0;
  const percentages = { low: percent(low), medium: percent(medium), high: percent(high) };
  const remainder = 100 - percentages.low - percentages.medium - percentages.high;
  const fractions = [['low', low], ['medium', medium], ['high', high]]
    .map(([key, count]) => ({ key, fraction: evaluated ? (count / evaluated) * 100 - percentages[key] : 0 }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let i = 0; i < remainder; i += 1) percentages[fractions[i]?.key ?? 'low'] += 1;
  return Object.freeze({
    summary: Object.freeze({
      totalTransactions: Number(value?.total_transactions ?? 0),
      transactionsEvaluated: Number(value?.transactions_evaluated ?? 0),
      highRiskTransactions: high,
      averageRiskScore: Number(value?.average_risk_score ?? 0),
      activeAlerts: Number(value?.active_alerts ?? 0),
      generatedAt: value?.generated_at ?? null,
    }),
    riskCounts: Object.freeze({ low, medium, high }),
    riskOverview: Object.freeze(percentages),
  });
}

export function createDashboardService(client = apiClient) {
  return Object.freeze({
    async getCategories(options = {}) {
      return adaptDashboardCategories(await client.get('/dashboard/categories', options));
    },
    async getSummary(options = {}) {
      return adaptDashboardSummary(await client.get('/dashboard/summary', options));
    },
  });
}

export const dashboardService = createDashboardService();
