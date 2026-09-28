import test from 'node:test';
import assert from 'node:assert/strict';

import { AUDIT_RULES } from '../src/data/auditRules.js';
import { AUDIT_RULE_DEFINITIONS } from '../src/utils/transactions.js';
import { toggleExpandedRuleIds } from '../src/utils/auditRules.js';

const expectedIds = ['RULE-001', 'RULE-002', 'RULE-003', 'RULE-004', 'RULE-005'];
const expectedNames = [
  'Segregation of Duties',
  'Approval Limits',
  'Duplicate Payments',
  'Invoice Splitting',
  'Ghost Vendors',
];

test('audit rule metadata contains exactly the five stable project rules in order', () => {
  assert.equal(AUDIT_RULES.length, 5);
  assert.deepEqual(AUDIT_RULES.map(({ id }) => id), expectedIds);
  assert.deepEqual(AUDIT_RULES.map(({ name }) => name), expectedNames);
});

test('every audit rule contains complete definition metadata', () => {
  const requiredKeys = [
    'id',
    'name',
    'category',
    'description',
    'requiredFields',
    'evaluation',
    'configurationNote',
    'status',
  ];

  AUDIT_RULES.forEach((rule) => {
    requiredKeys.forEach((key) => assert.ok(Object.hasOwn(rule, key), `${rule.id} is missing ${key}`));
    assert.equal(rule.status, 'Defined');
    assert.ok(rule.requiredFields.length > 0);
    assert.ok(rule.requiredFields.every((field) => typeof field === 'string' && field.length > 0));
    assert.ok(Object.values(rule).every((value) => typeof value !== 'function'));
  });
});

test('audit rule statuses do not imply backend execution', () => {
  const prohibitedStatuses = new Set(['Demo Only', 'Active', 'Running']);
  assert.ok(AUDIT_RULES.every(({ status }) => !prohibitedStatuses.has(status)));
});

test('transaction detail uses the same five centralized rule names', () => {
  assert.deepEqual(AUDIT_RULE_DEFINITIONS.map(({ label }) => label), expectedNames);
});

test('rule expansion state supports independent accessible disclosures', () => {
  const firstExpanded = toggleExpandedRuleIds(new Set(), 'RULE-001');
  const twoExpanded = toggleExpandedRuleIds(firstExpanded, 'RULE-003');
  const firstCollapsed = toggleExpandedRuleIds(twoExpanded, 'RULE-001');

  assert.deepEqual([...firstExpanded], ['RULE-001']);
  assert.deepEqual([...twoExpanded], ['RULE-001', 'RULE-003']);
  assert.deepEqual([...firstCollapsed], ['RULE-003']);
  assert.deepEqual([...firstExpanded], ['RULE-001'], 'previous state remains immutable');
});
