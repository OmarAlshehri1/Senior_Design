import test from 'node:test';
import assert from 'node:assert/strict';

import { AUDIT_RULES } from '../src/data/auditRules.js';
import { getRiskLevel, RISK_THRESHOLDS } from '../src/utils/risk.js';
import { getSettingsOverview } from '../src/utils/settings.js';

test('settings risk ranges derive from centralized risk configuration', () => {
  const settings = getSettingsOverview();

  assert.deepEqual(
    settings.riskClassification.map(({ label, min, max, range }) => ({ label, min, max, range })),
    [
      { label: 'Low Risk', min: 0, max: 49, range: '0–49' },
      { label: 'Medium Risk', min: 50, max: 74, range: '50–74' },
      { label: 'High Risk', min: 75, max: 100, range: '75–100' },
    ]
  );
  assert.equal(getRiskLevel(RISK_THRESHOLDS.LOW.max), 'Low Risk');
  assert.equal(getRiskLevel(RISK_THRESHOLDS.MEDIUM.min), 'Medium Risk');
  assert.equal(getRiskLevel(RISK_THRESHOLDS.HIGH.min), 'High Risk');
});

test('settings uses exactly the five centralized audit rule identities and statuses', () => {
  const rules = getSettingsOverview().auditRules;

  assert.equal(rules.length, 5);
  assert.deepEqual(
    rules,
    AUDIT_RULES.map(({ id, name, status }) => ({ id, name, status }))
  );
  assert.ok(rules.every(({ status }) => status === 'Defined'));
});

test('reporting configuration is an accurate read-only reference', () => {
  assert.deepEqual(getSettingsOverview().reporting, {
    frequency: 'Daily',
    reportType: 'Daily Audit Summary',
    status: 'Defined',
  });
});

test('real-time alert configuration describes the planned integration', () => {
  assert.deepEqual(getSettingsOverview().realTimeAlerts, {
    threshold: 'High Risk (75–100)',
    delivery: 'WebSocket',
    targetLatency: '≤ 5 seconds',
    status: 'Planned Integration',
  });
});

test('integration reference does not claim unavailable services are operational', () => {
  const settings = getSettingsOverview();
  const integrationText = JSON.stringify({
    realTimeAlerts: settings.realTimeAlerts,
    integration: settings.integration,
  });

  assert.doesNotMatch(integrationText, /"(Connected|Active|Running)"/i);
  assert.deepEqual(settings.integration, {
    transactionSource: 'Frontend Preview Dataset',
    apiIntegration: 'Pending',
    realTimeConnection: 'Pending',
    persistence: 'Pending',
  });
});

test('settings display derivation does not mutate centralized project metadata', () => {
  const originalRules = structuredClone(AUDIT_RULES);
  const originalThresholds = structuredClone(RISK_THRESHOLDS);
  const firstSettings = getSettingsOverview();
  const secondSettings = getSettingsOverview();

  firstSettings.auditRules[0].name = 'Changed display copy';
  firstSettings.riskClassification[0].min = -1;

  assert.deepEqual(AUDIT_RULES, originalRules);
  assert.deepEqual(RISK_THRESHOLDS, originalThresholds);
  assert.equal(secondSettings.auditRules[0].name, 'Segregation of Duties');
  assert.equal(secondSettings.riskClassification[0].min, 0);
});
