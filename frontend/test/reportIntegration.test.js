import test from 'node:test';
import assert from 'node:assert/strict';

import {
  adaptReport,
  adaptReportCollection,
} from '../src/adapters/reportAdapter.js';
import {
  createReportsService,
} from '../src/services/reportsService.js';

function buildPayload() {
  return {
    id: 'RPT-2026-10-03',
    type: 'DAILY',
    status: 'COMPLETED',
    period_start: '2026-10-03T00:00:00+00:00',
    period_end: '2026-10-04T00:00:00+00:00',
    created_at: '2026-10-03T04:06:31+00:00',
    completed_at: '2026-10-03T04:06:30+00:00',
    failure_reason: null,
    download_url: '/api/v1/reports/RPT-2026-10-03/download',
    summary: {
      report_version: '1.0.0',
      daily_summary: {
        total_transactions: 3,
        transactions_evaluated: 3,
        high_risk_transactions: 2,
        average_risk_score: 75.21,
        active_alerts: 1,
        reviewed_alerts: 2,
      },
      risk_distribution: {
        low: 1,
        medium: 0,
        high: 2,
      },
      alert_summary: {
        total: 3,
        active: 1,
        reviewed: 2,
        high: 3,
        medium: 0,
      },
      rule_summary: [
        {
          rule_key: 'duplicate_payment',
          rule_name: 'Duplicate Payment',
          violation_count: 2,
        },
      ],
      high_risk_transactions: [
        {
          id: 'TX-HIGH-001',
          timestamp: '2026-10-03T03:39:32+00:00',
          vendor_name: 'Example Vendor',
          amount: 500,
          currency: 'SAR',
          risk_score: 88,
          risk_level: 'HIGH',
        },
      ],
    },
  };
}

test('report adapter maps the authoritative backend report', () => {
  const report = adaptReport(buildPayload());

  assert.equal(report.id, 'RPT-2026-10-03');
  assert.equal(report.status, 'COMPLETED');
  assert.equal(report.reportVersion, '1.0.0');
  assert.deepEqual(report.dailySummary, {
    totalTransactions: 3,
    transactionsEvaluated: 3,
    highRiskTransactions: 2,
    averageRiskScore: 75.21,
    activeAlerts: 1,
    reviewedAlerts: 2,
  });
  assert.deepEqual(
    report.riskDistribution.map(({ key, count, percentage }) => ({
      key,
      count,
      percentage,
    })),
    [
      { key: 'low', count: 1, percentage: 33 },
      { key: 'medium', count: 0, percentage: 0 },
      { key: 'high', count: 2, percentage: 67 },
    ]
  );
  assert.equal(
    report.ruleSummary[0].violationCount,
    2
  );
  assert.equal(
    report.highRiskTransactions[0].riskScore,
    88
  );
});

test('report adapter safely handles invalid and missing values', () => {
  assert.equal(adaptReport(null), null);
  assert.deepEqual(adaptReportCollection(null), {
    items: [],
    total: 0,
    page: null,
    pageSize: null,
  });

  const report = adaptReport({
    id: 'RPT-EMPTY',
    summary: {
      daily_summary: {
        average_risk_score: null,
      },
    },
  });

  assert.equal(report.dailySummary.averageRiskScore, null);
  assert.equal(report.dailySummary.totalTransactions, 0);
  assert.equal(report.riskDistribution[0].percentage, 0);
});

test('reports service adapts list and generation responses', async () => {
  const requests = [];
  const payload = buildPayload();

  const client = {
    async get(path, options) {
      requests.push({ method: 'GET', path, options });
      return {
        items: [payload],
        total: 1,
        page: 1,
        page_size: 25,
      };
    },
    async post(path, body, options) {
      requests.push({
        method: 'POST',
        path,
        body,
        options,
      });
      return payload;
    },
  };

  const service = createReportsService(
    client,
    'http://localhost:8000/api/v1/'
  );
  const listed = await service.list({
    query: { page: 1, page_size: 25 },
  });
  const generated = await service.generate({
    type: 'DAILY',
    period_start: payload.period_start,
    period_end: payload.period_end,
  });

  assert.equal(listed.items[0].id, payload.id);
  assert.equal(generated.id, payload.id);
  assert.deepEqual(
    requests.map(({ method, path }) => ({ method, path })),
    [
      { method: 'GET', path: '/reports' },
      { method: 'POST', path: '/reports' },
    ]
  );
  assert.equal(
    service.getDownloadUrl(payload.id),
    'http://localhost:8000/api/v1/reports/'
      + 'RPT-2026-10-03/download'
  );
  assert.equal(service.getDownloadUrl(null), null);
});