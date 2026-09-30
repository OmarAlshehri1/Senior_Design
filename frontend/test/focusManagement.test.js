import test from 'node:test';
import assert from 'node:assert/strict';
import { getFocusWrapTarget } from '../src/accessibility/focusManagement.js';

test('forward Tab wraps from the last focusable element to the first', () => {
  const first = { id: 'first' };
  const last = { id: 'last' };
  assert.equal(getFocusWrapTarget([first, last], last), first);
});

test('Shift+Tab wraps from the first focusable element to the last', () => {
  const first = { id: 'first' };
  const last = { id: 'last' };
  assert.equal(getFocusWrapTarget([first, last], first, true), last);
});

test('focus outside the overlay is redirected inside in either direction', () => {
  const first = { id: 'first' };
  const last = { id: 'last' };
  assert.equal(getFocusWrapTarget([first, last], {}, false), first);
  assert.equal(getFocusWrapTarget([first, last], {}, true), last);
});

test('a single focusable element wraps to itself', () => {
  const only = { id: 'only' };
  assert.equal(getFocusWrapTarget([only], only), only);
  assert.equal(getFocusWrapTarget([only], only, true), only);
});

test('an overlay without focusable descendants has no wrap target', () => {
  assert.equal(getFocusWrapTarget([], null), null);
});
