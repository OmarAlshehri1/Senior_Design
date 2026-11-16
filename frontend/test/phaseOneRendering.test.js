import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createPagedResource } from '../src/utils/pagedResource.js';

let vite;
before(async () => {
  vite = await createServer({
    configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
    plugins: [react()], appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
});
after(async () => { await vite?.close(); });
const render = (component, props) => renderToStaticMarkup(
  createElement(MemoryRouter, null, createElement(component, props)),
);

test('both transaction tables render recorded currencies and never fill missing amount/currency', async () => {
  const rows = [
    { id: 'sar', amount: 12.5, currency: 'SAR' },
    { id: 'eur', amount: -12.56789, currency: 'EUR' },
    { id: 'unknown', amount: 99.25, currency: null },
    { id: 'missing', amount: null, currency: 'USD' },
  ];
  for (const file of ['TransactionsTable', 'RecentTransactionsTable']) {
    const { default: Table } = await vite.ssrLoadModule(`/src/components/${file}.jsx`);
    const html = render(Table, { transactions: rows });
    assert.match(html, /12\.5 SAR/);
    assert.match(html, /-12\.56789 EUR/);
    assert.match(html, />99\.25<\/td>/);
    assert.doesNotMatch(html, /99\.25 SAR|0 USD/);
    assert.match(html, /Not available/);
  }
});

test('temporary demo row is labelled, has no navigation, and preserves the real transaction row', async () => {
  const { default: Table } = await vite.ssrLoadModule('/src/components/RecentTransactionsTable.jsx');
  const real = { id: 'original-payment', vendor: 'Recorded Vendor', amount: 42, currency: 'SAR' };
  const demo = { id: 'TR-DEMO-001', vendor: 'Demo Vendor', amount: 1250, currency: 'USD', category: 'Presentation demo', riskLevel: 'Medium Risk' };
  const html = render(Table, { transactions: [real], demoTransaction: demo });
  assert.match(html, /Demo transaction, simulated result/);
  assert.match(html, />Demo<\/span>/);
  assert.match(html, /1,250 USD/);
  assert.match(html, /42 SAR/);
  assert.equal((html.match(/role="link"/g) ?? []).length, 1);
  assert.match(html, /aria-label="View transaction original-payment/);
  const withoutDemo = render(Table, { transactions: [real] });
  assert.doesNotMatch(withoutDemo, /Demo Vendor|TR-DEMO/);
  assert.equal((withoutDemo.match(/role="link"/g) ?? []).length, 1);
  assert.deepEqual(real, { id: 'original-payment', vendor: 'Recorded Vendor', amount: 42, currency: 'SAR' });
});

test('legacy report rows retain their own currency and missing amounts', async () => {
  const { LegacyReportTransactions } = await vite.ssrLoadModule('/src/pages/Reports.jsx');
  const html = render(LegacyReportTransactions, { transactions: [
    { id: 'eur', amount: -25.125, currency: 'EUR', riskScore: 90 },
    { id: 'unknown', amount: 99, currency: null, riskScore: 85 },
    { id: 'missing', amount: null, currency: 'SAR', riskScore: 80 },
  ] });
  assert.match(html, /-25\.125 EUR/);
  assert.match(html, />99<\/td>/);
  assert.match(html, /Not available/);
  assert.doesNotMatch(html, /99 SAR|0 SAR/);
});

test('Dashboard recent rendering distinguishes loading, error, valid empty and populated data', async () => {
  const { default: State } = await vite.ssrLoadModule('/src/components/RecentCollectionState.jsx');
  const props = { label: 'recent transactions', children: createElement('table', null, createElement('caption', null, 'Recent records')) };
  const loading = render(State, { ...props, loading: true, empty: true });
  assert.match(loading, /Loading recent transactions/);
  assert.doesNotMatch(loading, /No recent|<table/);
  const error = render(State, { ...props, error: 'offline', empty: true, onRetry: () => {} });
  assert.match(error, /role="alert"/);
  assert.match(error, /unavailable.*offline/);
  assert.match(error, /Retry/);
  assert.doesNotMatch(error, /No recent|<table/);
  assert.match(render(State, { ...props, empty: true }), /No recent transactions are available/);
  assert.match(render(State, { ...props, empty: false }), /<table/);
});

test('User Management shows supported capabilities without developer-facing copy', async () => {
  const { UsersView } = await vite.ssrLoadModule('/src/pages/UserManagement.jsx');
  const html = render(UsersView, { users: [{ id: 'u1', name: 'Existing user', role: 'AUDITOR', accountStatus: 'ACTIVE' }] });
  assert.doesNotMatch(html, /Global user search|not supported|user service/);
  assert.doesNotMatch(html, /<input|<select/);
  assert.match(html, /View User/);
});

test('shared list controls wire page/size events to server requests and expose the real result range', async () => {
  const { default: Controls } = await vite.ssrLoadModule('/src/components/CollectionPagination.jsx');
  const requests = [];
  const resource = createPagedResource(async ({ query }) => {
    requests.push(query);
    return { items: [{ id: 'one' }, { id: 'two' }], total: 202 };
  });
  await resource.load();
  let collection = { ...resource.getSnapshot(), resource };
  await Controls({ collection, itemLabel: 'saved daily summaries' }).props.onPageChange(3);
  collection = { ...resource.getSnapshot(), resource };
  const html = render(Controls, { collection, itemLabel: 'saved daily summaries' });
  assert.match(html, /Showing 21–22 of 202 saved daily summaries/);
  assert.match(html, /aria-current="page"/);
  await Controls({ collection, itemLabel: 'saved daily summaries' }).props.onPageSizeChange(100);
  assert.deepEqual(requests, [
    { page: 1, page_size: 10 }, { page: 3, page_size: 10 }, { page: 1, page_size: 100 },
  ]);
  assert.equal(Controls({ collection: { status: 'loading' } }), null);
  assert.equal(Controls({ collection: { status: 'error' } }), null);
});
