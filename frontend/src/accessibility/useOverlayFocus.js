import { useLayoutEffect, useRef } from 'react';
import {
  getFocusableElements,
  getFocusWrapTarget,
  makeOutsideContentInert,
} from './focusManagement.js';

export default function useOverlayFocus({
  active,
  containerRef,
  initialFocusRef,
  restoreFocusRef,
  boundaryRef = containerRef,
  onEscape,
  inertRefs = null,
}) {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useLayoutEffect(() => {
    if (!active) return undefined;

    const container = containerRef.current;
    const boundary = boundaryRef.current;
    if (!container || !boundary) return undefined;

    const opener = restoreFocusRef?.current
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const restoreInert = inertRefs
      ? (() => {
          const changed = inertRefs
            .map((reference) => reference.current)
            .filter((element) => element && !element.inert);
          for (const element of changed) element.inert = true;
          return () => {
            for (const element of changed) element.inert = false;
          };
        })()
      : makeOutsideContentInert(boundary);

    const focusables = getFocusableElements(container);
    const initialTarget = initialFocusRef?.current && !initialFocusRef.current.disabled
      ? initialFocusRef.current
      : focusables[0] ?? container;
    initialTarget.focus();
    const focusFrame = window.requestAnimationFrame(() => {
      if (initialTarget.isConnected && !container.contains(document.activeElement)) {
        initialTarget.focus();
      }
    });
    const focusTimer = window.setTimeout(() => {
      if (initialTarget.isConnected && !container.contains(document.activeElement)) {
        initialTarget.focus();
      }
    }, 0);

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && onEscapeRef.current) {
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const currentFocusable = getFocusableElements(container);
      const target = getFocusWrapTarget(currentFocusable, document.activeElement, event.shiftKey);
      if (target) {
        event.preventDefault();
        target.focus();
      } else if (currentFocusable.length === 0) {
        event.preventDefault();
        container.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', handleKeyDown, true);
      restoreInert();
      if (opener?.isConnected && typeof opener.focus === 'function') {
        opener.focus();
        window.setTimeout(() => {
          if (opener.isConnected && !opener.closest('[inert]')) opener.focus();
        }, 0);
      }
    };
  }, [active, boundaryRef, containerRef, inertRefs, initialFocusRef, restoreFocusRef]);
}
