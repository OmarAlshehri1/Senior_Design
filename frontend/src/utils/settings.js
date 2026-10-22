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
      delivery: 'WebSocket updates and in-app notifications',
      targetLatency: '≤ 5 seconds',
      status: 'Implemented; runtime health not checked',
    },
    integration: {
      transactionSource: 'Transaction API',
      apiIntegration: 'Implemented API integration',
      realTimeConnection: 'Implemented WebSocket integration',
      persistence: 'Backend persistence implemented',
    },
    system: {
      frontend: 'Continuous Auditing System',
      interfaceMode: 'Audit Dashboard',
    },
  };
}
