import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { caseReference, shortReference, eventLabel } from '../src/utils/presentation.js';
import { createAlertsService } from '../src/services/alertsService.js';
import { createAuditService } from '../src/audit/auditService.js';
import { normalizeAuditEvent } from '../src/audit/auditEvents.js';
import { createPagedResource, pageContext } from '../src/utils/pagedResource.js';

let vite;
before(async () => { vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [react()], appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] } }); });
after(async () => { await vite?.close(); });
const render = (Component, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Component, props)));
const reference = 'AL-00a0e5d8-2938-49de-8dc2-ab98624c9a57';
const strip = (html) => html.replace(/<[^>]*>/g, '');

test('display references preserve original navigation identifiers and disclose full source evidence', async () => {
  assert.equal(caseReference('CASE-000001'), 'Case #1');
  assert.equal(shortReference(reference), 'AL-00a0…9a57');
  assert.equal(reference, 'AL-00a0e5d8-2938-49de-8dc2-ab98624c9a57');
  const { CasesTable } = await vite.ssrLoadModule('/src/pages/Cases.jsx');
  const html = render(CasesTable, { items: [{ id: 'original-case-key', reference: 'CASE-000001', alertId: reference, status: 'CLOSED' }] });
  assert.match(html, /Case #1/);
  assert.match(html, /href="\/cases\/original-case-key"/);
  assert.match(html, /<summary[^>]*>AL-00a0…9a57<\/summary>/);
  assert.match(html, /class="reference-full">AL-00a0e5d8-2938-49de-8dc2-ab98624c9a57/);
  assert.doesNotMatch(strip(html), /UTC\+3/);
});

test('one-page authoritative results keep context/page-size but hide page navigation', async () => {
  const { default: Pagination } = await vite.ssrLoadModule('/src/components/Pagination.jsx');
  const html = render(Pagination, { currentPage: 1, totalPages: 1, pageSize: 10,
    firstItem: 1, lastItem: 3, totalItems: 3 });
  assert.match(strip(html), /Showing 1–3 of 3 transactions/);
  assert.match(html, /Rows per page/);
  assert.doesNotMatch(html, /<nav|Previous|Next|Page 1/);
});

test('unsupported risk deep links cannot present page-local matches as globally paginated results', async () => {
  const { default: Transactions } = await vite.ssrLoadModule('/src/pages/Transactions.jsx');
  const { default: Context } = await vite.ssrLoadModule('/src/context/contextStore.js');
  const state = { transactions: [{ id: 'one' }], transactionsLoading: false, transactionsTotal: 9853,
    transactionsPage: 1, transactionsPageSize: 10, transactionsSortBy: 'newest', setTransactionsPage() {}, setTransactionsSearch() {} };
  const html = renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/transactions?risk=high'] },
    createElement(Context.Provider, { value: state }, createElement(Transactions))));
  assert.match(strip(html), /This risk view is unavailable/);
  assert.doesNotMatch(html, /Showing 1–10|9853|9,853|pagination-pages|Rule Status|filter-chip/);
});

test('transaction result context represents all rows returned in an authoritative three-result page', async () => {
  const { default: Transactions } = await vite.ssrLoadModule('/src/pages/Transactions.jsx');
  const { default: Context } = await vite.ssrLoadModule('/src/context/contextStore.js');
  const state = { transactions: [{ id: 'evaluated' }, { id: 'pending', processing: true }, { id: 'not-evaluated' }],
    transactionsLoading: false, transactionsTotal: 3, transactionsPage: 1, transactionsPageSize: 10,
    transactionsSortBy: 'newest', setTransactionsPage() {}, setTransactionsSearch() {} };
  const html = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(Context.Provider, { value: state }, createElement(Transactions))));
  assert.match(strip(html), /Showing 1–3 of 3 transactions/);
  assert.equal((html.match(/role="link"/g) ?? []).length, 3);
  assert.doesNotMatch(html, /pagination-pages|on Page 1/);
});

test('Dashboard retains risk information without advertising unsupported global risk drilldowns', async () => {
  const { default: Cards } = await vite.ssrLoadModule('/src/components/SummaryCards.jsx');
  const { default: Chart } = await vite.ssrLoadModule('/src/components/DonutChart.jsx');
  const cards = render(Cards, { summary: { totalTransactions: 10, transactionsEvaluated: 10, highRiskTransactions: 3, averageRiskScore: 60 }, highRiskPercentage: 30 });
  const chart = render(Chart, { counts: { low: 5, medium: 2, high: 3 }, percentages: { low: 50, medium: 20, high: 30 }, total: 10 });
  assert.match(strip(cards), /High-Risk Transactions3/);
  assert.match(strip(chart), /High Risk3transactions30%/);
  assert.doesNotMatch(cards + chart, /href="\/transactions\?risk=/);
});

test('Alerts requests one server page and status/page-size changes reset page with exact server total', async () => {
  const calls = [];
  const service = createAlertsService({ get: async (path, options) => {
    calls.push({ path, ...options.query });
    return { items: [{ id: 'original-alert', status: 'ACTIVE' }], total: options.query.status ? 3 : 577 };
  } });
  const resource = createPagedResource(service.list);
  await resource.load(); await resource.setPage(3); await resource.setFilters({ status: 'ACTIVE' });
  assert.deepEqual(calls.map((call) => [call.path, call.page, call.page_size]), [['/alerts', 1, 10], ['/alerts', 3, 10], ['/alerts', 1, 10]]);
  assert.equal(resource.getSnapshot().total, 3);
  assert.equal(pageContext(resource.getSnapshot()).totalPages, 1);
  await resource.setPageSize(50); await resource.setPageSize(100);
  assert.deepEqual(calls.slice(-2).map((call) => [call.page, call.page_size, call.status]), [[1, 50, 'ACTIVE'], [1, 100, 'ACTIVE']]);
  resource.cancel();
});

test('Audit Log filters share the server count/page query and propagate cancellation', async () => {
  const calls = [];
  const service = createAuditService({ get: async (path, options) => {
    calls.push({ path, ...options }); return { items: [], total: options.query.action ? 3 : 500 };
  } });
  const resource = createPagedResource(({ query, signal }) => service.getAuditEvents(query, { signal }));
  await resource.load(); await resource.setPage(4); await resource.setFilters({ action: 'ALERT_REVIEWED', date: '2026-10-19', sort: 'OLDEST' });
  assert.equal(calls[0].query.page_size, 10);
  assert.equal(calls[2].path, '/audit-events');
  assert.equal(calls[2].query.page, 1);
  assert.equal(calls[2].query.action, 'ALERT_REVIEWED');
  assert.equal(calls[2].query.date, '2026-10-19');
  assert.equal(calls[2].query.sort, 'OLDEST');
  assert.equal(resource.getSnapshot().total, 3);
  assert.ok(calls[1].signal.aborted);
  resource.cancel();
});

test('team overview feed starts with five readable events from a bounded recent window', async () => {
  const { default: Feed } = await vite.ssrLoadModule('/src/components/TeamActivityFeed.jsx');
  const events = Array.from({ length: 13 }, (_, index) => ({ id: String(index), actorName: 'Actor',
    action: 'BUSINESS_REPORT_CREATED', resourceType: 'REPORT', resourceId: '20951686-caac-4e1f-bd93-0af67ebde460' }));
  const html = render(Feed, { events });
  assert.equal((html.match(/<li\b/g) ?? []).length, 5);
  assert.match(strip(html), /1–5 of 13 recent events/);
  assert.match(html, /Created business report/);
  assert.doesNotMatch(html, /BUSINESS_REPORT_CREATED/);
  assert.equal(eventLabel('ALERT_ASSIGNED'), 'Assigned alert');
  assert.equal(eventLabel('TEAM_MEMBER_ADDED'), 'Added team member');
  assert.equal(eventLabel('TEAM_CREATED'), 'Created team');
});

test('compact alert presentation keeps the original reference and never labels unknown review state Active', async () => {
  const { default: Table } = await vite.ssrLoadModule('/src/components/AlertsTable.jsx');
  const html = render(Table, { alerts: [{ id: reference, title: 'Recorded alert', riskScore: null, status: null }] });
  assert.match(html, /<summary[^>]*>AL-00a0…9a57<\/summary>/);
  assert.match(html, /class="reference-full">AL-00a0e5d8-2938-49de-8dc2-ab98624c9a57/);
  assert.match(strip(html), /Unavailable/);
  assert.doesNotMatch(strip(html), /Active|Low Risk|Score 0/);
});

test('audit list uses readable event/resource labels while details retain original identifiers and codes', async () => {
  const { AuditLogTable } = await vite.ssrLoadModule('/src/pages/AuditLog.jsx');
  const { default: Details } = await vite.ssrLoadModule('/src/components/AuditEventDetails.jsx');
  const event = { id: 'original-event', action: 'BUSINESS_REPORT_CREATED', resourceType: 'REPORT',
    resourceId: '20951686-caac-4e1f-bd93-0af67ebde460', outcome: 'SUCCESS' };
  const list = render(AuditLogTable, { events: [event] });
  assert.match(list, /Created business report/);
  assert.match(list, /Report 20951686…e460/);
  assert.doesNotMatch(list, /BUSINESS_REPORT_CREATED/);
  const details = render(Details, { event });
  assert.match(details, /BUSINESS_REPORT_CREATED/);
  assert.match(details, /20951686-caac-4e1f-bd93-0af67ebde460/);
  assert.match(details, /original-event/);
});

test('existing backend team events survive normalization instead of disappearing from counted audit pages', () => {
  for (const action of ['TEAM_CREATED', 'TEAM_UPDATED', 'TEAM_DEACTIVATED', 'TEAM_MEMBER_ADDED', 'TEAM_MEMBER_REMOVED', 'TEAM_MEMBER_TRANSFERRED']) {
    const resourceType = action.startsWith('TEAM_MEMBER') ? 'TEAM_MEMBER' : 'TEAM';
    const original = { id: 'original-event-id', action, resourceType, resourceId: 'original-resource-id', outcome: 'SUCCESS' };
    const normalized = normalizeAuditEvent(original);
    assert.equal(normalized.action, action);
    assert.equal(normalized.resourceId, original.resourceId);
    assert.equal(normalized.id, original.id);
  }
});
