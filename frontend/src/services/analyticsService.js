import { apiClient } from './apiClient.js';
import { createAuditCoverage, createTrendModel } from '../analytics/analyticsModels.js';

export function createAnalyticsService(client = apiClient) {
  return Object.freeze({
    async getOverview(period = '30_DAYS', options = {}) {
      const value = await client.get('/analytics', { ...options, query: { ...options.query, period } });
      return Object.freeze({
        coverage: createAuditCoverage(value?.coverage),
        riskTrends: createTrendModel({ period, series: value?.risk_trends }),
        ruleViolationTrends: createTrendModel({ period, series: value?.rule_violation_trends }),
      });
    },
    async getAuditCoverage(options = {}) { return (await this.getOverview(options.period, options)).coverage; },
    async getRiskTrends(options = {}) { return (await this.getOverview(options.period, options)).riskTrends; },
    async getRuleViolationTrends(options = {}) { return (await this.getOverview(options.period, options)).ruleViolationTrends; },
  });
}

export const analyticsService = createAnalyticsService();
