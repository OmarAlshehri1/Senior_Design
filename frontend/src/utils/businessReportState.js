// Frontend request state only. Every read/download still uses the existing
// authenticated service and its backend reauthorization.
export function createBusinessReportController(service, saveFile) {
  let state = {
    list: { status: 'loading', refreshing: false, page: 1, items: [], total: null, error: '', unavailable: false },
    selected: null,
    preview: { status: 'idle', html: '', reportId: '', error: '' },
    busy: { generate: false, pdf: false, xlsx: false },
    errors: { generate: '', pdf: '', xlsx: '' },
    notice: '',
  };
  const listeners = new Set();
  let listController, previewController;
  let listSequence = 0, previewSequence = 0, lifetime = 0;
  const publish = (patch) => { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); };
  const operation = (name, busy, error = '') => publish({
    busy: { ...state.busy, [name]: busy }, errors: { ...state.errors, [name]: error },
  });
  const message = (error) => error?.code === 'CONFIGURATION_UNAVAILABLE'
    ? 'The reporting integration is unavailable.' : error?.message || 'The request could not be completed.';

  const select = async (report) => {
    const request = ++previewSequence;
    previewController?.abort();
    previewController = new AbortController();
    publish({ selected: report, errors: { ...state.errors, pdf: '', xlsx: '' },
      preview: { status: report ? 'loading' : 'idle', html: '', reportId: report?.id ?? '', error: '' } });
    if (!report) return;
    try {
      const blob = await service.download(report.id, 'html', { signal: previewController.signal });
      const html = await blob.text();
      if (request !== previewSequence) return;
      if (!html.trim()) throw new Error('The memorandum preview was empty.');
      publish({ preview: { status: 'success', html, reportId: report.id, error: '' } });
    } catch (error) {
      if (request !== previewSequence) return;
      publish({ preview: { status: 'error', html: '', reportId: report.id, error: message(error) },
        ...([401, 403, 404].includes(error?.status) ? { selected: null } : {}) });
    }
  };

  const loadList = async (page = state.list.page, preferredId = state.selected?.id) => {
    const request = ++listSequence;
    listController?.abort();
    listController = new AbortController();
    const refreshing = state.list.total !== null && state.list.page === page;
    if (!refreshing) select(null);
    publish({ list: { ...state.list, page, status: 'loading', refreshing, error: '', unavailable: false,
      ...(!refreshing ? { items: [], total: null } : {}) } });
    try {
      const result = await service.list({ query: { page, page_size: 10 }, signal: listController.signal });
      if (request !== listSequence) return;
      if (!Array.isArray(result?.items) || !Number.isFinite(result.total) || result.total < 0) throw new Error('Saved reports could not be read.');
      const lastPage = Math.max(1, Math.ceil(result.total / 10));
      if (page > lastPage) return loadList(lastPage, preferredId);
      publish({ list: { status: 'success', refreshing: false, page, items: result.items, total: result.total, error: '', unavailable: false } });
      // Preview is deliberately not awaited by list or export availability.
      select(result.items.find((item) => item.id === preferredId) ?? result.items[0] ?? null);
    } catch (error) {
      if (request !== listSequence) return;
      select(null);
      publish({ list: { status: 'error', refreshing: false, page, items: [], total: null,
        error: message(error), unavailable: error?.code === 'CONFIGURATION_UNAVAILABLE' } });
    }
  };

  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    loadList,
    selectId: (id) => select(state.list.items.find((item) => item.id === id) ?? null),
    retryPreview: () => select(state.selected),
    generate: async (input) => {
      if (state.busy.generate) return;
      const generation = lifetime;
      operation('generate', true);
      publish({ notice: '' });
      try {
        const saved = await service.create(input);
        if (generation !== lifetime) return;
        if (!saved?.id) throw new Error('The generated report response was invalid.');
        publish({ notice: 'Business report generated.' });
        await loadList(1, saved.id);
      } catch (error) {
        if (generation === lifetime) operation('generate', true, message(error));
      } finally {
        if (generation === lifetime) operation('generate', false, state.errors.generate);
      }
    },
    download: async (format) => {
      if (!['pdf', 'xlsx'].includes(format) || !state.selected?.id || state.busy[format]) return;
      const generation = lifetime;
      const id = state.selected.id;
      operation(format, true);
      try {
        const blob = await service.download(id, format);
        if (generation !== lifetime) return;
        await saveFile(blob, id, format);
      } catch (error) {
        if (generation === lifetime) operation(format, true, message(error));
      } finally {
        if (generation === lifetime) operation(format, false, state.errors[format]);
      }
    },
    cancel: () => {
      lifetime += 1;
      listSequence += 1;
      previewSequence += 1;
      listController?.abort();
      previewController?.abort();
    },
  };
}
