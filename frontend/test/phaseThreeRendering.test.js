import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { createBusinessReportController } from '../src/utils/businessReportState.js';

let vite;
before(async () => {
  vite = await createServer({ configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
    plugins: [react()], appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] } });
});
after(async () => { await vite?.close(); });
const render = (component, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(component, props)));
const text = (node) => node == null || typeof node === 'boolean' ? '' : typeof node === 'string' || typeof node === 'number' ? String(node)
  : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
const find = (node, predicate) => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap((child) => find(child, predicate)) : [...(predicate(node) ? [node] : []), ...find(node.props?.children, predicate)];
const buttons = (tree) => find(tree, (node) => node.type === 'button');
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('application freshness is unavailable before the first successful data response', async () => {
  const { AppProvider } = await vite.ssrLoadModule('/src/context/AppContext.jsx');
  const { default: useApp } = await vite.ssrLoadModule('/src/context/useApp.js');
  function Freshness() {
    return createElement('output', null, useApp().lastUpdated ?? 'Not yet updated');
  }
  const html = renderToStaticMarkup(createElement(AppProvider, null, createElement(Freshness)));
  assert.equal(html, '<output>Not yet updated</output>');
});

test('User Management arrows/Home/End update selected tab, roving tabindex and focus, including wrapping', async () => {
  const { UserManagementTabs } = await vite.ssrLoadModule('/src/pages/UserManagement.jsx');
  for (const [start, key, expected] of [
    ['users', 'ArrowRight', 'requests'], ['requests', 'ArrowLeft', 'users'],
    ['users', 'ArrowLeft', 'disabled'], ['disabled', 'ArrowRight', 'users'],
    ['locked', 'Home', 'users'], ['users', 'End', 'disabled'],
  ]) {
    let activeTab = start, focused, prevented = 0, changes = 0;
    const onSelect = (value) => { activeTab = value; changes += 1; };
    const tree = UserManagementTabs({ activeTab, counts: {}, onSelect });
    const tab = buttons(tree).find((button) => button.props.id === `management-tab-${start}`);
    tab.props.onKeyDown({ key, preventDefault: () => prevented++, currentTarget: {
      parentElement: { querySelector: (selector) => ({ focus: () => { focused = selector; } }) },
    } });
    assert.equal(activeTab, expected);
    assert.equal(focused, `#management-tab-${expected}`);
    assert.equal(prevented, 1);
    assert.equal(changes, 1);
    const updated = buttons(UserManagementTabs({ activeTab, counts: {}, onSelect }));
    assert.equal(updated.filter((button) => button.props['aria-selected']).length, 1);
    assert.equal(updated.find((button) => button.props.tabIndex === 0).props.id, `management-tab-${expected}`);
    assert.equal(updated.filter((button) => button.props.tabIndex === -1).length, 4);
  }
});

test('tab Enter/Space retains native button activation and clicks select once', async () => {
  const { UserManagementTabs } = await vite.ssrLoadModule('/src/pages/UserManagement.jsx');
  const selections = [];
  const tab = buttons(UserManagementTabs({ activeTab: 'users', counts: {}, onSelect: (key) => selections.push(key) }))[1];
  for (const key of ['Enter', ' ']) tab.props.onKeyDown({ key, preventDefault: () => assert.fail('Native activation must be preserved') });
  assert.deepEqual(selections, []);
  tab.props.onClick();
  assert.deepEqual(selections, ['requests']);
});

test('transaction row keys navigate once while vendor link keys and clicks retain native link navigation', async () => {
  const { TransactionsTableView } = await vite.ssrLoadModule('/src/components/TransactionsTable.jsx');
  const navigations = [];
  const props = { transactions: [{ id: 'tx-1', vendorId: 'vendor-1', vendor: 'Existing vendor' }], onOpenTransaction: (id) => navigations.push(id) };
  const tree = TransactionsTableView(props);
  const row = find(tree, (node) => node.type === 'tr' && node.props.role === 'link')[0];
  const link = find(tree, (node) => node.props?.to === '/vendors/vendor-1')[0];
  for (const key of ['Enter', ' ']) {
    const target = {};
    let prevented = 0;
    row.props.onKeyDown({ key, target, currentTarget: target, preventDefault: () => prevented++ });
    assert.equal(prevented, 1);
  }
  assert.deepEqual(navigations, ['tx-1', 'tx-1']);
  for (const key of ['Enter', ' ']) row.props.onKeyDown({ key, target: {}, currentTarget: {},
    preventDefault: () => assert.fail('The row must not intercept the vendor link') });
  let stopped = false;
  link.props.onClick({ stopPropagation: () => { stopped = true; } });
  if (!stopped) row.props.onClick();
  assert.equal(stopped, true);
  assert.equal(link.props.to, '/vendors/vendor-1');
  assert.deepEqual(navigations, ['tx-1', 'tx-1']);
  assert.match(render(TransactionsTableView, props), /href="\/vendors\/vendor-1"/);
  row.props.onClick();
  assert.equal(navigations.length, 3);
});

test('Cases, Vendors and every Vendor Profile table cell retain the matching mobile field label', async () => {
  const { CasesTable } = await vite.ssrLoadModule('/src/pages/Cases.jsx');
  const { VendorsTable } = await vite.ssrLoadModule('/src/pages/Vendors.jsx');
  const { VendorProfileContent } = await vite.ssrLoadModule('/src/pages/VendorProfile.jsx');
  const timestamp = '2026-10-19T14:10:38Z';
  const examples = [
    [CasesTable, { items: [{ id: 'case-1', status: 'OPEN', priority: 'MEDIUM', updatedAt: timestamp }] }],
    [VendorsTable, { vendors: [{ id: 'vendor-1', name: 'Existing vendor', monitoringStatus: 'NORMAL' }] }],
    [VendorProfileContent, { bundle: {
      vendor: { id: 'vendor-1', name: 'Existing vendor' },
      requests: [{ id: 'request-1', status: 'PENDING', requested_at: timestamp }],
      transactions: [{ id: 'tx-1', timestamp, amount: 25, currency: 'EUR' }],
      risk_history: [{ transaction_id: 'tx-1', calculated_at: timestamp }],
    }, can: () => false }],
  ];
  let tableCount = 0;
  for (const [Component, props] of examples) {
    const html = render(Component, props);
    for (const table of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/g)) {
      tableCount++;
      const headers = [...table[1].matchAll(/<th>(.*?)<\/th>/g)].map((match) => match[1]);
      const cells = [...table[1].matchAll(/<td\b([^>]*)>/g)];
      assert.equal(cells.length, headers.length);
      cells.forEach((cell, index) => assert.ok(cell[1].includes(`data-label="${headers[index]}"`), headers[index]));
    }
  }
  assert.equal(tableCount, 5);
});

test('Business Report view keeps exports active after preview failure with independent busy text and errors', async () => {
  const { BusinessReportsView } = await vite.ssrLoadModule('/src/components/BusinessReports.jsx');
  let resolvePdf, resolveExcel, resolveGeneration;
  const pendingPdf = new Promise((resolve) => { resolvePdf = resolve; });
  const pendingExcel = new Promise((resolve) => { resolveExcel = resolve; });
  const pendingGeneration = new Promise((resolve) => { resolveGeneration = resolve; });
  const controller = createBusinessReportController({
    list: async () => ({ items: [{ id: 'saved-1', scope: 'TEAM' }], total: 1 }),
    create: () => pendingGeneration,
    download: async (_, format) => { if (format === 'html') throw new Error('Preview offline'); return format === 'pdf' ? pendingPdf : pendingExcel; },
  }, async () => {});
  await controller.loadList(); await flush();
  const props = () => ({ state: controller.getSnapshot(), controller, form: { day: '', recipient: 'Management', sender: 'Team', dataContext: 'UNVERIFIED', useGemini: false }, setForm: () => {} });
  let tree = BusinessReportsView(props());
  let pdf = buttons(tree).find((button) => text(button) === 'Download Business Report');
  const excel = buttons(tree).find((button) => text(button) === 'Download Excel Appendix');
  assert.equal(pdf.props.disabled, false); assert.equal(excel.props.disabled, false);
  assert.match(render(BusinessReportsView, props()), /Preview offline/);
  const task = pdf.props.onClick();
  tree = BusinessReportsView(props());
  pdf = buttons(tree).find((button) => text(button) === 'Downloading PDF…');
  assert.equal(pdf.props.disabled, true); assert.equal(pdf.props['aria-busy'], true);
  assert.equal(buttons(tree).find((button) => text(button) === 'Download Excel Appendix').props.disabled, false);
  assert.equal(buttons(tree).find((button) => text(button) === 'Generate Business Report').props.disabled, false);
  const excelTask = excel.props.onClick();
  tree = BusinessReportsView(props());
  assert.equal(buttons(tree).find((button) => text(button) === 'Downloading Excel…').props.disabled, true);
  const generationTask = controller.generate(props().form);
  tree = BusinessReportsView(props());
  assert.equal(buttons(tree).find((button) => text(button) === 'Generating…').props.disabled, true);
  assert.doesNotMatch(render(BusinessReportsView, props()), /Saving…|>Print</);
  resolvePdf(new Blob(['pdf'])); await task;
  assert.equal(controller.getSnapshot().busy.xlsx, true);
  resolveExcel(new Blob(['xlsx'])); await excelTask;
  resolveGeneration({ id: 'saved-1' }); await generationTask; await flush();
  controller.cancel();
});

test('Business Report list failures and integration unavailability are not empty successes', async () => {
  const { BusinessReportsView } = await vite.ssrLoadModule('/src/components/BusinessReports.jsx');
  const controller = createBusinessReportController({ list: async () => { throw Object.assign(new Error('Not configured'), { code: 'CONFIGURATION_UNAVAILABLE' }); } }, async () => {});
  await controller.loadList();
  const html = render(BusinessReportsView, { state: controller.getSnapshot(), controller, form: {}, setForm: () => {} });
  assert.match(html, /Reporting integration unavailable/);
  assert.match(html, /Retry saved reports/);
  assert.doesNotMatch(html, /No business reports|0 drafts/);
  controller.cancel();
});

test('Profile history distinguishes loading, refresh, request error, unavailable, empty and populated', async () => {
  const { ProfileHistory } = await vite.ssrLoadModule('/src/pages/Profile.jsx');
  for (const [status, refreshing, error, expected] of [
    ['loading', false, '', 'Loading sign-in history'], ['loading', true, '', 'Refreshing sign-in history'],
    ['error', false, 'Request failed', 'Request failed'], ['unavailable', false, 'Integration unavailable', 'Sign-in history unavailable'],
  ]) {
    const html = render(ProfileHistory, { history: { status, refreshing, error, items: [] }, onRefresh: () => {} });
    assert.ok(html.includes(expected));
    assert.doesNotMatch(html, /No sign-in history/);
  }
  assert.match(render(ProfileHistory, { history: { status: 'success', items: [] } }), /No sign-in history/);
  assert.match(render(ProfileHistory, { history: { status: 'success', items: [{ id: 'login', outcome: 'SUCCESS', timestamp: '2026-10-19T14:10:38Z' }] } }), /Successful sign-in/);
});

test('success/info toasts announce politely and errors use assertive atomic announcements', async () => {
  const { Toast } = await vite.ssrLoadModule('/src/components/Notification.jsx');
  for (const type of ['success', 'info', 'error']) {
    const notification = { key: 'one-message', type, message: 'Action result' };
    const node = Toast({ notification });
    assert.equal(node.props.role, type === 'error' ? 'alert' : 'status');
    assert.equal(node.props['aria-live'], type === 'error' ? 'assertive' : 'polite');
    assert.equal(node.props['aria-atomic'], 'true');
    assert.equal(text(node), 'Action result');
    assert.equal(Toast({ notification }).key, node.key);
  }
});

test('Topbar Sign out remains a named button and mobile/notification accessible names remain intact', async () => {
  const { default: Topbar } = await vite.ssrLoadModule('/src/components/Topbar.jsx');
  const { default: AppContext } = await vite.ssrLoadModule('/src/context/contextStore.js');
  const { default: AuthorizationContext } = await vite.ssrLoadModule('/src/auth/authorizationStore.js');
  const html = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(AppContext.Provider, { value: { notifications: [], lastUpdated: null, unreadNotificationCount: 0 } },
      createElement(AuthorizationContext.Provider, { value: { mode: 'AUTHENTICATED', effectiveRole: 'ADMIN', user: { id: 'existing-user', role: 'ADMIN' } } }, createElement(Topbar)))));
  assert.match(html, /<button type="button" class="topbar-sign-out"[^>]*>Sign out<\/button>/);
  assert.match(html, /aria-label="Open notifications"/);
  assert.match(html, /aria-label="Toggle navigation menu"/);
  assert.doesNotMatch(html, /<button[^>]*class="topbar-profile-preview-link"/);
});
