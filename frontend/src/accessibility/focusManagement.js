const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function isVisible(element) {
  return element.getClientRects().length > 0
    && window.getComputedStyle(element).visibility !== 'hidden';
}

export function getFocusableElements(container) {
  if (!container) return [];
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => (
    !element.closest('[inert]') && isVisible(element)
  ));
}

export function getFocusWrapTarget(elements, activeElement, backwards = false) {
  if (elements.length === 0) return null;
  const first = elements[0];
  const last = elements[elements.length - 1];

  if (!elements.includes(activeElement)) return backwards ? last : first;
  if (backwards && activeElement === first) return last;
  if (!backwards && activeElement === last) return first;
  return null;
}

export function makeOutsideContentInert(boundary) {
  const changed = [];
  let current = boundary;

  while (current?.parentElement) {
    for (const sibling of current.parentElement.children) {
      if (sibling === current || sibling.inert) continue;
      sibling.inert = true;
      changed.push(sibling);
    }
    current = current.parentElement;
  }

  return () => {
    for (const element of changed) element.inert = false;
  };
}
