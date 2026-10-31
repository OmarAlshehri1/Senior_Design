import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { shortReference, transactionReference } from '../src/utils/presentation.js';
import { ALERT_RULE_OPTIONS, getAlertRuleLabels } from '../src/utils/alerts.js';
import { adaptAlert } from '../src/adapters/alertAdapter.js';
import { createAlertsService } from '../src/services/alertsService.js';
import { createPagedResource, pageContext } from '../src/utils/pagedResource.js';

let vite;
before(async () => { vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
  plugins: [react()], appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] } }); });
after(async () => { await vite?.close(); });
const render = (Component, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Component, props)));
const strip = (html) => html.replace(/<[^>]*>/g, '');
const PAY_ID = 'PAY-8b03b1b8161836d1b93ff5fc40bcd8af';

test('generated payment IDs display as a deterministic short TR reference', () => {
  assert.equal(transactionReference(PAY_ID), 'TR-8B03B1B8');
  assert.equal(transactionReference(PAY_ID), transactionReference(`${PAY_ID}`));
  assert.equal(shortReference(PAY_ID), 'TR-8B03B1B8');
  assert.equal(transactionReference('PAY-ffffff00000000000000000000000000'), 'TR-FFFFFF00');
  for (const human of ['TXN-1001', 'INV-2026-0042', 'PAY-123', 'ALT-PAY-8b03b1b8161836d1b93ff5fc40bcd8af']) {
    assert.equal(transactionReference(human), human);
  }
  assert.notEqual(shortReference(`ALT-${PAY_ID}`), 'TR-8B03B1B8');
  assert.equal(transactionReference(null), '—');
});

test('transaction tables show the short reference and keep the original ID available', async () => {
  const { default: TransactionsTable } = await vite.ssrLoadModule('/src/components/TransactionsTable.jsx');
  const { default: RecentTransactionsTable } = await vite.ssrLoadModule('/src/components/RecentTransactionsTable.jsx');
  const { default: AlertsTable } = await vite.ssrLoadModule('/src/components/AlertsTable.jsx');
  for (const html of [
    render(TransactionsTable, { transactions: [{ id: PAY_ID, amount: 10, currency: 'USD' }] }),
    render(RecentTransactionsTable, { transactions: [{ id: PAY_ID, amount: 10, currency: 'USD' }] }),
    render(AlertsTable, { alerts: [{ id: `ALT-${PAY_ID}`, transactionId: PAY_ID, status: 'Active', title: 'Payment requires review' }] }),
  ]) {
    assert.match(html, /<summary title="PAY-8b03b1b8161836d1b93ff5fc40bcd8af">TR-8B03B1B8<\/summary>/);
    assert.match(html, /class="reference-full">PAY-8b03b1b8161836d1b93ff5fc40bcd8af</);
    assert.match(html, /aria-label="View transaction TR-8B03B1B8/);
  }
});

test('transaction links route with the original stored ID', async () => {
  const { LegacyReportTransactions } = await vite.ssrLoadModule('/src/pages/Reports.jsx');
  const html = render(LegacyReportTransactions, { transactions: [{ id: PAY_ID, vendor: 'Northwind', amount: 5, currency: 'USD' }] });
  assert.match(html, /href="\/transactions\/PAY-8b03b1b8161836d1b93ff5fc40bcd8af"/);
  assert.match(html, /title="PAY-8b03b1b8161836d1b93ff5fc40bcd8af"/);
  assert.match(strip(html), /TR-8B03B1B8/);
  assert.doesNotMatch(strip(html), /PAY-8b03b1/);
  const { CasesTable } = await vite.ssrLoadModule('/src/pages/Cases.jsx');
  const cases = render(CasesTable, { items: [{ id: 'case-key', reference: 'CASE-000002', transactionId: PAY_ID, status: 'OPEN' }] });
  assert.match(cases, /<summary title="PAY-8b03b1b8161836d1b93ff5fc40bcd8af">TR-8B03B1B8<\/summary>/);
  assert.match(cases, /href="\/cases\/case-key"/);
});

test('transaction detail copy action and metadata expose the full original ID', async () => {
  const { CopyReference } = await vite.ssrLoadModule('/src/pages/TransactionDetail.jsx');
  const html = render(CopyReference, { value: PAY_ID });
  assert.match(html, /title="PAY-8b03b1b8161836d1b93ff5fc40bcd8af">TR-8B03B1B8<\/span>/);
  assert.match(html, /<button type="button" title="Copy full transaction ID PAY-8b03b1b8161836d1b93ff5fc40bcd8af" aria-label="Copy full transaction ID">/);
  const source = await (await import('node:fs/promises')).readFile(new URL('../src/pages/TransactionDetail.jsx', import.meta.url), 'utf8');
  assert.match(source, /navigator\.clipboard\.writeText\(value\)/);
  assert.match(source, /label="Transaction ID" value=\{<span className="reference-text reference-full-id">\{transaction\.id\}<\/span>\}/);
});

test('alert queue names the triggered rules instead of repeating review sentences', async () => {
  const { default: AlertsTable } = await vite.ssrLoadModule('/src/components/AlertsTable.jsx');
  const alert = adaptAlert({ id: `ALT-${PAY_ID}`, transaction_id: PAY_ID, status: 'ACTIVE', severity: 'HIGH', risk_score: 88,
    title: 'Payment requires review', description: 'Rule and Payments model results require auditor review.',
    rule_keys: ['ghost_vendors', 'approval_limits'] });
  const html = render(AlertsTable, { alerts: [{ ...alert, reasonText: alert.description }] });
  const text = strip(html);
  assert.doesNotMatch(text, /Payment requires review/);
  assert.doesNotMatch(text, /require auditor review/);
  assert.match(text, /Approval Limits · Ghost Vendors/);
  assert.match(text, /High Risk/);
  assert.match(text, /Score 88/);
  assert.match(text, /Active/);
  assert.match(text, /TR-8B03B1B8/);
  assert.match(text, /Mark Reviewed/);
  assert.match(html, /title="Payment requires review"/);
  const withoutRules = strip(render(AlertsTable, { alerts: [{ ...adaptAlert({ id: 'AL-1', transaction_id: 'TXN-1', status: 'ACTIVE', title: 'High-risk transaction detected', description: 'The transaction requires auditor review.' }), reasonText: 'The transaction requires auditor review.' }] }));
  assert.match(withoutRules, /High-risk transaction detected/);
  assert.doesNotMatch(withoutRules, /requires auditor review/);
});

test('audit rule filter offers the five rules by stored key', async () => {
  assert.deepEqual(ALERT_RULE_OPTIONS.map(({ value }) => value),
    ['segregation_of_duties', 'approval_limits', 'duplicate_payment', 'invoice_splitting', 'ghost_vendors']);
  assert.deepEqual(getAlertRuleLabels(['ghost_vendors', 'unknown']), ['Ghost Vendors']);
  const { AlertFilters } = await vite.ssrLoadModule('/src/pages/Alerts.jsx');
  const props = { summary: '7 alerts', activeCount: 1, onClear() {}, advanced: true, types: ['Payment requires review'],
    query: { rule: 'ghost_vendors' }, search: '', onSearch() {}, onFilter() {} };
  const html = render(AlertFilters, { ...props, ruleFilter: true });
  assert.match(html, /<label[^>]*>Audit Rule<\/label>/);
  for (const label of ['All Rules', 'Segregation of Duties', 'Approval Limits', 'Duplicate Payments', 'Invoice Splitting', 'Ghost Vendors']) {
    assert.match(html, new RegExp(`>${label}</option>`));
  }
  assert.match(html, /<option value="ghost_vendors" selected="">Ghost Vendors<\/option>/);
  assert.ok(html.indexOf('Risk') < html.indexOf('Audit Rule') && html.indexOf('Audit Rule') < html.indexOf('Sort'));
  assert.doesNotMatch(render(AlertFilters, { ...props, ruleFilter: false }), /Audit Rule/);
});

test('selected rule is sent to the backend, resets to page 1 and composes with other filters', async () => {
  const requests = [];
  const service = createAlertsService({ get: async (path, options) => { requests.push({ path, query: options.query });
    return { items: Array.from({ length: Math.min(10, 37) }, (_, index) => ({ id: `AL-${index}` })), total: 37, page: options.query.page, page_size: 10 }; } });
  const resource = createPagedResource(service.list);
  await resource.load({ page: 3, page_size: 10, status: 'ACTIVE', severity: 'HIGH', type: 'Payment requires review', search: 'north', sort: 'OLDEST' });
  await resource.setFilters({ rule: 'ghost_vendors' });
  assert.deepEqual(requests.at(-1), { path: '/alerts', query: { page: 1, page_size: 10, status: 'ACTIVE', severity: 'HIGH',
    type: 'Payment requires review', search: 'north', sort: 'OLDEST', rule: 'ghost_vendors' } });
  await resource.setPage(2);
  await resource.setFilters({ severity: undefined });
  assert.equal(requests.at(-1).query.page, 1);
  assert.equal(requests.at(-1).query.rule, 'ghost_vendors');
  await resource.setFilters({ rule: undefined });
  assert.equal(requests.at(-1).query.rule, undefined);
});

test('authoritative rule totals drive the pagination summary and page count', async () => {
  const { default: Pagination } = await vite.ssrLoadModule('/src/components/Pagination.jsx');
  const seven = pageContext({ query: { page: 1, page_size: 10 }, total: 7, items: Array.from({ length: 7 }) });
  const sevenHtml = render(Pagination, { ...seven, itemLabel: 'alerts' });
  assert.match(strip(sevenHtml), /Showing 1–7 of 7 alerts/);
  assert.doesNotMatch(sevenHtml, /aria-label="Page 1"/);
  assert.doesNotMatch(sevenHtml, /pagination-pages/);
  const thirtySeven = pageContext({ query: { page: 1, page_size: 10 }, total: 37, items: Array.from({ length: 10 }) });
  assert.equal(thirtySeven.totalPages, 4);
  const html = render(Pagination, { ...thirtySeven, itemLabel: 'alerts' });
  assert.match(strip(html), /Showing 1–10 of 37 alerts/);
  for (const page of [1, 2, 3, 4]) assert.match(html, new RegExp(`aria-label="Page ${page}"`));
  assert.doesNotMatch(html, /aria-label="Page 5"/);
});
