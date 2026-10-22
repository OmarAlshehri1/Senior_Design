import test from 'node:test';
import assert from 'node:assert/strict';
import { createBusinessReportController } from '../src/utils/businessReportState.js';
import { createPagedResource } from '../src/utils/pagedResource.js';

const draft = { id: 'existing-draft', period_start: '2026-10-19T00:00:00Z', period_end: '2026-10-20T00:00:00Z', scope: 'TEAM' };
const flush = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const service = (overrides = {}) => ({
  list: async () => ({ items: [draft], total: 1 }),
  download: async (_, format) => new Blob([format]),
  create: async () => draft,
  ...overrides,
});

test('HTML failure leaves PDF and XLSX usable and preserves their distinct bytes/extensions', async () => {
  const calls = [], saved = [];
  const controller = createBusinessReportController(service({ download: async (id, format) => {
    calls.push({ id, format });
    if (format === 'html') throw new Error('Preview offline');
    return new Blob([format === 'pdf' ? '%PDF-document' : 'XLSX-workbook']);
  } }), async (blob, id, format) => saved.push({ content: await blob.text(), filename: `BR-${id}.${format}` }));
  await controller.loadList(); await flush();
  assert.equal(controller.getSnapshot().preview.status, 'error');
  assert.equal(controller.getSnapshot().selected.id, draft.id);
  await controller.download('pdf'); await controller.download('xlsx');
  assert.deepEqual(calls.map((call) => call.format), ['html', 'pdf', 'xlsx']);
  assert.deepEqual(saved, [
    { content: '%PDF-document', filename: 'BR-existing-draft.pdf' },
    { content: 'XLSX-workbook', filename: 'BR-existing-draft.xlsx' },
  ]);
  controller.cancel();
});

for (const failed of ['pdf', 'xlsx']) {
  test(`${failed} failure does not disable or report failure for the other export`, async () => {
    const other = failed === 'pdf' ? 'xlsx' : 'pdf';
    const saved = [];
    const controller = createBusinessReportController(service({ download: async (_, format) => {
      if (format === failed) throw new Error('Export unavailable');
      return new Blob([format]);
    } }), async (_, id, format) => saved.push(format));
    await controller.loadList(); await flush();
    await controller.download(failed);
    assert.equal(controller.getSnapshot().errors[failed], 'Export unavailable');
    assert.equal(controller.getSnapshot().errors[other], '');
    assert.equal(controller.getSnapshot().busy[other], false);
    await controller.download(other);
    assert.deepEqual(saved, [other]);
    controller.cancel();
  });
}

test('each operation has its own synchronous duplicate guard; safe exports can overlap generation', async () => {
  const pdf = deferred(), xlsx = deferred(), generation = deferred();
  const calls = [], saved = [];
  const controller = createBusinessReportController(service({
    create: () => { calls.push('generate'); return generation.promise; },
    download: (_, format) => { calls.push(format); return format === 'html' ? Promise.resolve(new Blob(['preview'])) : format === 'pdf' ? pdf.promise : xlsx.promise; },
  }), async (_, id, format) => saved.push(format));
  await controller.loadList(); await flush();
  const firstPdf = controller.download('pdf');
  await controller.download('pdf');
  assert.deepEqual(controller.getSnapshot().busy, { generate: false, pdf: true, xlsx: false });
  const firstXlsx = controller.download('xlsx');
  const firstGeneration = controller.generate({ day: '' });
  await controller.generate({ day: '' });
  assert.deepEqual(controller.getSnapshot().busy, { generate: true, pdf: true, xlsx: true });
  pdf.resolve(new Blob(['pdf'])); await firstPdf;
  assert.equal(controller.getSnapshot().busy.pdf, false);
  assert.equal(controller.getSnapshot().busy.xlsx, true);
  xlsx.resolve(new Blob(['xlsx'])); await firstXlsx;
  generation.resolve(draft); await firstGeneration; await flush();
  assert.equal(calls.filter((name) => name === 'generate').length, 1);
  assert.equal(calls.filter((name) => name === 'pdf').length, 1);
  assert.equal(calls.filter((name) => name === 'xlsx').length, 1);
  assert.deepEqual(saved, ['pdf', 'xlsx']);
  assert.equal(controller.getSnapshot().notice, 'Business report generated.');
  controller.cancel();
});

test('saved-list loading/error/empty/refresh states are distinct and no failure manufactures a zero total', async () => {
  let fail = false, empty = false;
  const pendingRefresh = deferred();
  let refresh = false;
  const controller = createBusinessReportController(service({ list: async () => {
    if (fail) throw new Error('List offline');
    if (refresh) return pendingRefresh.promise;
    return { items: empty ? [] : [draft], total: empty ? 0 : 1 };
  } }), async () => {});
  assert.equal(controller.getSnapshot().list.status, 'loading');
  assert.equal(controller.getSnapshot().list.total, null);
  await controller.loadList(); await flush();
  refresh = true;
  const task = controller.loadList();
  assert.equal(controller.getSnapshot().list.refreshing, true);
  pendingRefresh.resolve({ items: [draft], total: 1 }); await task;
  refresh = false; fail = true; await controller.loadList();
  assert.equal(controller.getSnapshot().list.status, 'error');
  assert.equal(controller.getSnapshot().list.total, null);
  assert.equal(controller.getSnapshot().selected, null);
  fail = false; empty = true; await controller.loadList();
  assert.equal(controller.getSnapshot().list.status, 'success');
  assert.equal(controller.getSnapshot().list.total, 0);
  controller.cancel();
});

test('stale preview responses cannot replace the selected revision', async () => {
  const oldPreview = deferred();
  const controller = createBusinessReportController(service({
    list: async () => ({ items: [draft, { ...draft, id: 'second' }], total: 2 }),
    download: (id) => id === draft.id ? oldPreview.promise : Promise.resolve(new Blob(['second preview'])),
  }), async () => {});
  await controller.loadList();
  await controller.selectId('second');
  oldPreview.resolve(new Blob(['old preview'])); await flush();
  assert.equal(controller.getSnapshot().preview.reportId, 'second');
  assert.equal(controller.getSnapshot().preview.html, 'second preview');
  controller.cancel();
});

test('an explicit access denial clears the selected draft and blocks exports until refreshed authorization', async () => {
  const calls = [];
  const controller = createBusinessReportController(service({ download: async (_, format) => {
    calls.push(format); throw Object.assign(new Error('Access changed'), { status: 404 });
  } }), async () => assert.fail('No download should be saved'));
  await controller.loadList(); await flush();
  assert.equal(controller.getSnapshot().selected, null);
  await controller.download('pdf'); await controller.download('xlsx');
  assert.deepEqual(calls, ['html']);
  controller.cancel();
});

test('failed generation keeps its error separate and does not change the submitted input', async () => {
  const input = Object.freeze({ day: '2026-10-19', recipient: 'Management', sender: 'Team', dataContext: 'UNVERIFIED', useGemini: false });
  const controller = createBusinessReportController(service({ create: async (received) => {
    assert.equal(received, input); throw new Error('Generation offline');
  } }), async () => {});
  await controller.loadList(); await flush();
  await controller.generate(input);
  assert.equal(controller.getSnapshot().errors.generate, 'Generation offline');
  assert.equal(controller.getSnapshot().busy.generate, false);
  assert.equal(controller.getSnapshot().selected.id, draft.id);
  assert.equal(input.day, '2026-10-19');
  controller.cancel();
});

test('Business Report pages clamp after scope changes and cancellation prevents delayed downloads', async () => {
  const calls = [], exportRequest = deferred();
  const controller = createBusinessReportController(service({
    list: async ({ query }) => { calls.push(query.page); return { items: query.page === 1 ? [draft] : [], total: 1 }; },
    download: (_, format) => format === 'pdf' ? exportRequest.promise : Promise.resolve(new Blob(['preview'])),
  }), async () => assert.fail('Unmounted view must not trigger a file download'));
  await controller.loadList(3); await flush();
  assert.deepEqual(calls, [3, 1]);
  const download = controller.download('pdf');
  controller.cancel(); exportRequest.resolve(new Blob(['pdf'])); await download;
});

test('affected paginated lists identify background refresh while withholding stale rows', async () => {
  const response = deferred();
  let refresh = false;
  const resource = createPagedResource(async () => refresh ? response.promise : { items: [{ id: 'existing' }], total: 1 });
  assert.equal(resource.getSnapshot().refreshing, false);
  await resource.load();
  refresh = true;
  const task = resource.load();
  assert.equal(resource.getSnapshot().refreshing, true);
  assert.deepEqual(resource.getSnapshot().items, []);
  response.resolve({ items: [], total: 0 }); await task;
  assert.equal(resource.getSnapshot().status, 'success');
  assert.equal(resource.getSnapshot().refreshing, false);
});
