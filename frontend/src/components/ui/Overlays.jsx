import { useEffect, useId, useRef, useState } from 'react';
import useOverlayFocus from '../../accessibility/useOverlayFocus.js';
import { MoreIcon, XIcon } from '../icons.jsx';

// Modal dialog or side drawer with trapped focus, Escape and focus return.
export function Dialog({ open, title, description, eyebrow, onClose, children, footer, variant = 'modal', size = 'md', role = 'dialog', busy = false, initialFocusRef, suppressEscape = false }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef(null);
  const backdropRef = useRef(null);
  const closeRef = useRef(null);
  useOverlayFocus({ active: open, containerRef: dialogRef, boundaryRef: backdropRef, initialFocusRef: initialFocusRef ?? closeRef, onEscape: busy || suppressEscape ? undefined : onClose });
  if (!open) return null;
  return <div ref={backdropRef} className={`overlay overlay-${variant}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
    <section ref={dialogRef} tabIndex="-1" className={`dialog dialog-${variant} dialog-${size}`} role={role} aria-modal="true"
      aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
      <header className="dialog-header">
        <div>
          {eyebrow && <p className="dialog-eyebrow">{eyebrow}</p>}
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId} className="dialog-description">{description}</p>}
        </div>
        <button ref={closeRef} type="button" className="icon-button" aria-label="Close" onClick={onClose} disabled={busy}><XIcon width={18} height={18} /></button>
      </header>
      <div className="dialog-body">{children}</div>
      {footer && <footer className="dialog-footer">{footer}</footer>}
    </section>
  </div>;
}

// Overflow menu for secondary row actions (menu button pattern).
export function ActionMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const visible = items.filter(Boolean);
  useEffect(() => {
    if (!open) return undefined;
    // Fixed positioning keeps the menu visible inside scrolling tables.
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const below = window.innerHeight - rect.bottom > 180;
      setPosition({ right: Math.max(8, window.innerWidth - rect.right), ...(below ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }) });
    }
    menuRef.current?.querySelector('[role="menuitem"]:not([disabled])')?.focus();
    const onPointerDown = (event) => {
      if (!menuRef.current?.contains(event.target) && !buttonRef.current?.contains(event.target)) setOpen(false);
    };
    const onViewportChange = () => setOpen(false);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);
  if (!visible.length) return null;
  const close = (restore = true) => { setOpen(false); if (restore) buttonRef.current?.focus(); };
  const onMenuKeyDown = (event) => {
    event.stopPropagation();
    const entries = [...(menuRef.current?.querySelectorAll('[role="menuitem"]:not([disabled])') ?? [])];
    const index = entries.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); entries[(index + 1) % entries.length]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); entries[(index - 1 + entries.length) % entries.length]?.focus(); }
    else if (event.key === 'Home') { event.preventDefault(); entries[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); entries.at(-1)?.focus(); }
    else if (event.key === 'Tab') close(false);
  };
  return <div className="action-menu" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
    <button ref={buttonRef} type="button" className="icon-button" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen((value) => !value)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); } }}>
      <MoreIcon width={18} height={18} />
    </button>
    {open && <div ref={menuRef} id={menuId} className="action-menu-list" role="menu" aria-label={label} style={position ?? undefined} onKeyDown={onMenuKeyDown}>
      {visible.map((item) => <button key={item.label} type="button" role="menuitem" tabIndex={-1} disabled={item.disabled}
        className={item.tone === 'danger' ? 'is-danger' : undefined} onClick={() => { close(); item.onSelect(); }}>{item.label}</button>)}
    </div>}
  </div>;
}
