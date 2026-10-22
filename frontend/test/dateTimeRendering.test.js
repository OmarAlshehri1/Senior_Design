import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';

let vite;
const raw = '2026-10-19T14:10:38.816954+00:00';
before(async () => {
  vite = await createServer({
    configFile: false, root: fileURLToPath(new URL('..', import.meta.url)),
    plugins: [react()], appType: 'custom',
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
});
after(async () => { await vite?.close(); });
const render = (component, props) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(component, props)));
const visible = (html) => html.replace(/<[^>]*>/g, '');

test('semantic time keeps the exact raw value and provides a compact, zoned accessible label', async () => {
  const { default: DateTime } = await vite.ssrLoadModule('/src/components/DateTime.jsx');
  const html = render(DateTime, { value: raw, compact: true, showZone: false });
  assert.match(html, /dateTime="2026-10-19T14:10:38\.816954\+00:00"/);
  assert.match(html, /aria-label="19 Oct 2026, 17:10:38 \(UTC\+3\)"/);
  assert.match(html, /<span>19 Oct 2026<\/span><span>17:10:38<\/span>/);
  assert.doesNotMatch(visible(html), /2026-10-19|816954/);
});

test('date-only and invalid semantic displays do not manufacture an instant', async () => {
  const { default: DateTime } = await vite.ssrLoadModule('/src/components/DateTime.jsx');
  const date = render(DateTime, { value: '2022-01-03', compact: true });
  assert.match(date, /dateTime="2022-01-03"/);
  assert.equal(visible(date), '3 Jan 2022');
  for (const value of [null, 'invalid', '2026-10-19T14:10:38']) {
    const html = render(DateTime, { value });
    assert.doesNotMatch(html, /<time|Invalid Date|00:00/);
  }
});

test('history, notification, discussion and audit detail views format their original timestamps', async () => {
  const cases = [
    ['LoginHistory', { records: [{ id: 'login', outcome: 'SUCCESS', timestamp: raw }] }],
    ['ReviewHistory', { records: [{ id: 'review', action: 'REVIEWED', timestamp: raw }] }],
    ['TeamActivityFeed', { events: [{ id: 'team', action: 'REVIEWED', timestamp: raw }] }],
    ['AssignmentHistory', { records: [{ id: 'assignment', assignedAt: raw }] }],
    ['CaseActivityTimeline', { events: [{ id: 'case', type: 'CASE_CREATED', timestamp: raw }] }],
    ['CaseDiscussion', { comments: [{ id: 'comment', createdAt: raw, message: 'Recorded note' }] }],
    ['AuditEventDetails', { event: { id: 'event', timestamp: raw } }],
    ['NotificationCenter', { open: true, notifications: [{ id: 'notice', timestamp: raw }] }],
    ['AccessRequestDetails', { request: { id: 'request', requestedAt: raw, status: 'PENDING' } }],
    ['CaseClosureDialog', { open: true, mode: 'approve', caseRecord: { closureRequestedAt: raw } }],
  ];
  for (const [file, props] of cases) {
    const { default: Component } = await vite.ssrLoadModule(`/src/components/${file}.jsx`);
    const html = render(Component, props);
    assert.match(visible(html), /19 Oct 2026, 17:10:38 \(UTC\+3\)/, file);
    assert.doesNotMatch(visible(html), /2026-10-19T14:10:38|Invalid Date/, file);
    assert.match(html, /dateTime="2026-10-19T14:10:38\.816954\+00:00"/, file);
  }
});

test('users and transaction/alert tables expose compact dates with explicit zone context', async () => {
  const { UsersView } = await vite.ssrLoadModule('/src/pages/UserManagement.jsx');
  const { default: TransactionsTable } = await vite.ssrLoadModule('/src/components/TransactionsTable.jsx');
  const { default: AlertsTable } = await vite.ssrLoadModule('/src/components/AlertsTable.jsx');
  for (const [Component, props] of [
    [UsersView, { users: [{ id: 'u', role: 'AUDITOR', lastLoginAt: raw }] }],
    [TransactionsTable, { transactions: [{ id: 't', timestamp: raw, amount: 25, currency: 'EUR' }] }],
    [AlertsTable, { alerts: [{ id: 'a', timestamp: raw, title: 'Review', status: 'Reviewed' }] }],
  ]) {
    const html = render(Component, props);
    assert.match(visible(html), /UTC\+3/);
    assert.match(html, /<span>19 Oct 2026<\/span><span>17:10:38<\/span>/);
    assert.doesNotMatch(visible(html), /2026-10-19T14:10:38/);
  }
});

test('explicit raw audit/case evidence retains original values instead of rewriting recorded content', async () => {
  const { default: AuditEventDetails } = await vite.ssrLoadModule('/src/components/AuditEventDetails.jsx');
  const { default: CaseActivityTimeline } = await vite.ssrLoadModule('/src/components/CaseActivityTimeline.jsx');
  for (const html of [
    render(AuditEventDetails, { event: { timestamp: raw, details: { recorded_at: raw } } }),
    render(CaseActivityTimeline, { events: [{ id: 'event', type: 'CASE_CREATED', timestamp: raw, details: { sla_due_at: raw } }] }),
  ]) {
    assert.match(visible(html), /Recorded details \(raw\)/);
    assert.match(visible(html), /2026-10-19T14:10:38\.816954\+00:00/);
    assert.match(visible(html), /19 Oct 2026, 17:10:38 \(UTC\+3\)/);
  }
});

test('Topbar makes the time-only timezone explicit and reports can deliberately remain UTC', async () => {
  const { default: Topbar } = await vite.ssrLoadModule('/src/components/Topbar.jsx');
  const { default: AppContext } = await vite.ssrLoadModule('/src/context/contextStore.js');
  const { default: AuthorizationContext } = await vite.ssrLoadModule('/src/auth/authorizationStore.js');
  const html = renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(AppContext.Provider, { value: { lastUpdated: raw, notifications: [], unreadNotificationCount: 0 } },
      createElement(AuthorizationContext.Provider, { value: { mode: 'AUTHENTICATED', effectiveRole: 'ADMIN', user: null } },
        createElement(Topbar, {})))));
  assert.match(visible(html), /17:10:38 \(UTC\+3\)/);
  const { default: DateTime } = await vite.ssrLoadModule('/src/components/DateTime.jsx');
  assert.equal(visible(render(DateTime, { value: '2026-10-19T22:30:00Z', utc: true })), '19 Oct 2026, 22:30:00 (UTC)');
});
