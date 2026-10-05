export const PAGE_SIZE_OPTIONS = Object.freeze([10, 50, 100]);

export function getTotalPages(totalItems, pageSize) {
  const safeTotal = Number.isFinite(Number(totalItems))
    ? Math.max(0, Math.trunc(Number(totalItems)))
    : 0;
  const safePageSize = Number.isFinite(Number(pageSize)) && Number(pageSize) > 0
    ? Math.trunc(Number(pageSize))
    : PAGE_SIZE_OPTIONS[0];

  return Math.max(1, Math.ceil(safeTotal / safePageSize));
}

export function normalizePageSize(value) {
  const numericValue = Number(value);
  return PAGE_SIZE_OPTIONS.includes(numericValue)
    ? numericValue
    : PAGE_SIZE_OPTIONS[0];
}

export function getPageSizeChange(value) {
  return Object.freeze({
    pageSize: normalizePageSize(value),
    page: 1,
  });
}

export function shouldShowPageNavigation(totalPages) {
  return Math.max(1, Math.trunc(Number(totalPages)) || 1) > 1;
}

export function getPaginationState(currentPage, totalPages) {
  const safeTotal = Math.max(1, Math.trunc(Number(totalPages)) || 1);
  const safeCurrent = Math.min(
    safeTotal,
    Math.max(1, Math.trunc(Number(currentPage)) || 1)
  );

  return Object.freeze({
    previousDisabled: safeCurrent === 1,
    nextDisabled: safeCurrent === safeTotal,
  });
}

export function getPaginationItems(currentPage, totalPages) {
  const safeTotal = Math.max(1, Math.trunc(Number(totalPages)) || 1);
  const safeCurrent = Math.min(
    safeTotal,
    Math.max(1, Math.trunc(Number(currentPage)) || 1)
  );

  if (safeTotal <= 7) {
    return Array.from({ length: safeTotal }, (_, index) => index + 1);
  }

  if (safeCurrent <= 4) {
    return [1, 2, 3, 4, 5, 'ellipsis-end', safeTotal];
  }

  if (safeCurrent >= safeTotal - 3) {
    return [
      1,
      'ellipsis-start',
      safeTotal - 4,
      safeTotal - 3,
      safeTotal - 2,
      safeTotal - 1,
      safeTotal,
    ];
  }

  return [
    1,
    'ellipsis-start',
    safeCurrent - 1,
    safeCurrent,
    safeCurrent + 1,
    'ellipsis-end',
    safeTotal,
  ];
}
