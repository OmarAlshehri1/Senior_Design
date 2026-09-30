import { AUDIT_RULES } from '../data/auditRules.js';
import { RISK_THRESHOLDS } from './risk.js';

export function getSettingsOverview() {
  return {
    organization: {
      name: 'Retail Store Operations',
      currency: 'SAR',
    },
    riskClassification: Object.values(RISK_THRESHOLDS).map(({ label, min, max }) => ({
      label,
      min,
      max,
      range: `${min}–${max}`,
    })),
    auditRules: AUDIT_RULES.map(({ id, name, status }) => ({ id, name, status })),
    reporting: {
      frequency: 'Daily',
      reportType: 'Daily Audit Summary',
      status: 'Defined',
    },
    realTimeAlerts: {
      threshold: `${RISK_THRESHOLDS.HIGH.label} (${RISK_THRESHOLDS.HIGH.min}–${RISK_THRESHOLDS.HIGH.max})`,
      delivery: 'System notifications',
      targetLatency: '≤ 5 seconds',
      status: 'Planned',
    },
    integration: {
      transactionSource: 'Current Dataset',
      apiIntegration: 'Not available',
      realTimeConnection: 'Not available',
      persistence: 'Not available',
    },
    system: {
      frontend: 'Continuous Auditing System',
      interfaceMode: 'Audit Dashboard',
    },
  };
}
