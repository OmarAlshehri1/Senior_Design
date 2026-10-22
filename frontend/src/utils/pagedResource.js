import { getTotalPages, normalizePageSize } from './pagination.js';

// One server page at a time. A new request invalidates the previous response,
// including transports that do not honor AbortSignal.
export function createPagedResource(loader, initialQuery = {}) {
  let state = { query: { page: 1, page_size: 10, ...initialQuery }, status: 'loading', items: [], total: null, error: null, hasLoaded: false, refreshing: false };
  let controller;
  let sequence = 0;
  const listeners = new Set();
  const publish = (next) => { state = next; listeners.forEach((listener) => listener()); };
  const cancel = () => { sequence += 1; controller?.abort(); };
  const load = async (query = state.query) => {
    cancel();
    const request = sequence;
    controller = new AbortController();
    const signal = controller.signal;
    const requested = { ...query };
    const hasLoaded = state.hasLoaded;
    publish({ query: requested, status: 'loading', items: [], total: null, error: null, hasLoaded, refreshing: hasLoaded });
    try {
      const result = await loader({ query: requested, signal });
      if (request !== sequence) return;
      if (!Array.isArray(result?.items) || !Number.isFinite(result.total) || result.total < 0) {
        throw new Error('The list service returned an invalid page.');
      }
      const lastPage = getTotalPages(result.total, requested.page_size);
      if (requested.page > lastPage) return load({ ...requested, page: lastPage });
      publish({ query: requested, status: 'success', items: result.items, total: result.total, error: null, hasLoaded: true, refreshing: false });
    } catch (error) {
      if (request !== sequence) return;
      publish({ query: requested, status: 'error', items: [], total: null,
        error: error instanceof Error ? error.message : 'Records could not be loaded.', hasLoaded, refreshing: false });
    }
  };
  return {
    getSnapshot: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    load,
    cancel,
    setPage: (page) => load({ ...state.query, page: Math.max(1, Math.trunc(page) || 1) }),
    setPageSize: (size) => load({ ...state.query, page: 1, page_size: normalizePageSize(size) }),
    setFilters: (filters) => load({ ...state.query, ...filters, page: 1 }),
  };
}

export function pageContext({ query, total, items }) {
  return {
    currentPage: query.page,
    pageSize: query.page_size,
    totalPages: getTotalPages(total, query.page_size),
    totalItems: total,
    firstItem: items.length ? (query.page - 1) * query.page_size + 1 : 0,
    lastItem: items.length ? (query.page - 1) * query.page_size + items.length : 0,
  };
}
