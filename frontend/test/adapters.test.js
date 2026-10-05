import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptAlert } from '../src/adapters/alertAdapter.js';
import { adaptTransaction } from '../src/adapters/transactionAdapter.js';

const backendTransaction = {
  id: 'TX-1',
  timestamp: '2026-09-20T14:42:03Z',
  vendor_id: 'VEN-1',
  vendor_name: 'Example Supplier',
  category: 'Inventory',
  amount: 1200,
  currency: 'SAR',
  rule_status: 'REVIEW',
  rule_score: 80,
  ai_score: 70,
  risk_score: 76,
  risk_level: 'HIGH',
  data_quality_status: 'COMPLETE',
  missing_fields: ['approval_limit'],
  rule_results: [{
    rule_key: 'duplicate_payment',
    status: 'FAILED',
    score_contribution: 35,
    detail: 'Possible duplicate payment.',
    evidence: { invoice_id: 'INV-1' },
  }],
  explanation: { summary: 'Recorded evidence requires review.' },
};

test('transaction adapter maps the documented backend shape', () => {
  const transaction = adaptTransaction(backendTransaction);

  assert.equal(transaction.id, 'TX-1');
  assert.equal(transaction.date, 'September 20, 2026');
  assert.equal(transaction.time, '14:42');
  assert.equal(transaction.vendorId, 'VEN-1');
  assert.equal(transaction.vendor, 'Example Supplier');
  assert.equal(transaction.ruleStatus, 'Review');
  assert.equal(transaction.riskLevel, 'High Risk');
  assert.equal(transaction.dataQuality.status, 'Complete');
  assert.deepEqual(transaction.dataQuality.missingFields, ['approval_limit']);
  assert.deepEqual(transaction.rules.duplicatePayment, {
    status: 'Failed',
    detail: 'Possible duplicate payment.',
    scoreContribution: 35,
    evidence: { invoice_id: 'INV-1' },
  });
});

test('transaction adapter preserves an authoritative empty missing-fields list', () => {
  const transaction = adaptTransaction({
    id: 'TX-COMPLETE',
    data_quality_status: 'COMPLETE',
    missing_fields: [],
  });

  assert.deepEqual(transaction.dataQuality.missingFields, []);
});

test('transaction adapter preserves safe missing states without inventing scores', () => {
  const transaction = adaptTransaction({ id: 'TX-INCOMPLETE', vendor_name: null });

  assert.equal(transaction.id, 'TX-INCOMPLETE');
  assert.equal(transaction.vendor, null);
  assert.equal(transaction.ruleScore, null);
  assert.equal(transaction.aiScore, null);
  assert.equal(transaction.riskScore, null);
  assert.equal(transaction.rules, null);
  assert.equal(transaction.riskExplanation, null);
});

test('alert adapter maps expected fields and nullable values safely', () => {
  assert.deepEqual(adaptAlert({
    id: 'AL-1',
    transaction_id: 'TX-1',
    created_at: '2026-09-20T14:42:03Z',
    severity: 'HIGH',
    risk_score: 88,
    latency_ms: 3556.213,
    title: 'Review required',
    description: null,
    reason: 'Recorded evidence requires review.',
    status: 'ACTIVE',
    reviewed_at: null,
  }), {
    id: 'AL-1',
    transactionId: 'TX-1',
    timestamp: '2026-09-20T14:42:03Z',
    time: '14:42',
    severity: 'High',
    riskScore: 88,
    latencyMs: 3556.213,
    title: 'Review required',
    description: null,
    reason: 'Recorded evidence requires review.',
    status: 'Active',
    reviewedAt: null,
    vendor: null,
    assignment: null,
  });
});

test('adapters reject non-object payloads safely', () => {
  assert.equal(adaptTransaction(null), null);
  assert.equal(adaptTransaction([]), null);
  assert.equal(adaptAlert('invalid'), null);
});

test('adapters do not mutate backend payloads', () => {
  const original = structuredClone(backendTransaction);
  const adapted = adaptTransaction(backendTransaction);
  adapted.rules.duplicatePayment.evidence.invoice_id = 'changed';

  assert.deepEqual(backendTransaction, original);
});
