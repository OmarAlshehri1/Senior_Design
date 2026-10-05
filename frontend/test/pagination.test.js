import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getPaginationItems,
  getPaginationState,
  getPageSizeChange,
  getTotalPages,
  normalizePageSize,
  PAGE_SIZE_OPTIONS,
  shouldShowPageNavigation,
} from '../src/utils/pagination.js';

test('page-size options are the supported server page sizes', () => {
  assert.deepEqual(PAGE_SIZE_OPTIONS, [10, 50, 100]);
  assert.equal(normalizePageSize('50'), 50);
  assert.equal(normalizePageSize(500), 10);
  assert.equal(normalizePageSize(999), 10);
});

test('changing page size always resets server pagination to page one', () => {
  assert.deepEqual(getPageSizeChange('100'), { pageSize: 100, page: 1 });
});

test('page navigation is hidden for one-page results and shown for multiple pages', () => {
  assert.equal(shouldShowPageNavigation(1), false);
  assert.equal(shouldShowPageNavigation(2), true);
  assert.equal(shouldShowPageNavigation(1002), true);
});

test('total-page calculation is safe for empty and malformed values', () => {
  assert.equal(getTotalPages(0, 10), 1);
  assert.equal(getTotalPages(201, 10), 21);
  assert.equal(getTotalPages(201, 50), 5);
  assert.equal(getTotalPages('bad', 0), 1);
});

test('pagination window uses ellipses near the beginning, middle, and end', () => {
  assert.deepEqual(getPaginationItems(1, 21), [1, 2, 3, 4, 5, 'ellipsis-end', 21]);
  assert.deepEqual(getPaginationItems(9, 21), [1, 'ellipsis-start', 8, 9, 10, 'ellipsis-end', 21]);
  assert.deepEqual(getPaginationItems(21, 21), [1, 'ellipsis-start', 17, 18, 19, 20, 21]);
  assert.deepEqual(getPaginationItems(3, 5), [1, 2, 3, 4, 5]);
});

test('pagination clamps invalid current pages', () => {
  assert.deepEqual(getPaginationItems(0, 3), [1, 2, 3]);
  assert.deepEqual(getPaginationItems(99, 3), [1, 2, 3]);
});

test('pagination state disables directions at the first and last page', () => {
  assert.deepEqual(getPaginationState(1, 21), {
    previousDisabled: true,
    nextDisabled: false,
  });
  assert.deepEqual(getPaginationState(21, 21), {
    previousDisabled: false,
    nextDisabled: true,
  });
});
