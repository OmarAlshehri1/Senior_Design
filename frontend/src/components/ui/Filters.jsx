import { useId, useMemo, useRef, useState } from 'react';
import { ChevronDownIcon, SearchIcon, XIcon } from '../icons.jsx';

// Toolbar for list pages. Controls are chosen by option cardinality:
// segmented (2–5), select (bounded), combobox (searchable bounded), search (unbounded).
export function FilterBar({ label, children, activeCount = 0, onClear, summary }) {
  return <section className="filter-bar" aria-label={label}>
    <div className="filter-bar-controls">{children}</div>
    {(summary || activeCount > 0) && <div className="filter-bar-footer">
      {summary && <p className="filter-bar-summary" aria-live="polite">{summary}</p>}
      {activeCount > 0 && onClear && <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
        <XIcon width={14} height={14} aria-hidden="true" />Clear filters{activeCount > 1 ? ` (${activeCount})` : ''}
      </button>}
    </div>}
  </section>;
}

export function SearchField({ label, value, onChange, placeholder, id }) {
  const generated = useId();
  const inputId = id ?? generated;
  return <div className="search-field">
    <label className="sr-only" htmlFor={inputId}>{label}</label>
    <SearchIcon className="search-field-icon" width={16} height={16} aria-hidden="true" />
    <input id={inputId} type="search" value={value} placeholder={placeholder} autoComplete="off" onChange={(event) => onChange(event.target.value)} />
    {value && <button type="button" className="search-field-clear" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => onChange('')}><XIcon width={14} height={14} /></button>}
  </div>;
}

export function SelectField({ label, value, onChange, options, disabled = false }) {
  const id = useId();
  const active = options[0] && value !== options[0].value;
  return <div className={`select-field${active ? ' is-active' : ''}`}>
    <label htmlFor={id}>{label}</label>
    <select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    <ChevronDownIcon className="select-field-chevron" width={14} height={14} aria-hidden="true" />
  </div>;
}

export function SegmentedControl({ label, value, options, onChange, disabled = false }) {
  const groupRef = useRef(null);
  const labelId = useId();
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const move = (event) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    let next;
    if (keys[event.key]) next = (index + keys[event.key] + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;
    event.preventDefault();
    onChange(options[next].value);
    groupRef.current?.querySelectorAll('[role="radio"]')[next]?.focus();
  };
  return <div className="segmented-field">
    <span className="segmented-label" id={labelId}>{label}</span>
    <div ref={groupRef} className="segmented" role="radiogroup" aria-labelledby={labelId}>
      {options.map((option, optionIndex) => <button key={option.value} type="button" role="radio" disabled={disabled}
        aria-checked={option.value === value} tabIndex={optionIndex === index ? 0 : -1}
        className={`segment${option.value === value ? ' is-selected' : ''}${option.tone ? ` tone-${option.tone}` : ''}`}
        onKeyDown={move} onClick={() => onChange(option.value)}>
        {option.tone && <span className="segment-dot" aria-hidden="true" />}{option.label}
      </button>)}
    </div>
  </div>;
}

// Searchable single-select for bounded lists (ARIA 1.2 combobox pattern).
export function Combobox({ label, value, onChange, options, allLabel = 'All', placeholder = 'Type to filter' }) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const choices = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matches = options.filter((option) => !term || option.label.toLowerCase().includes(term));
    return [{ value: '', label: allLabel }, ...matches];
  }, [allLabel, options, query]);
  const selected = options.find((option) => option.value === value);
  const close = () => { setOpen(false); setQuery(''); };
  const choose = (option) => { onChange(option.value); close(); };
  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex((current) => Math.min(choices.length - 1, open ? current + 1 : 0)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((current) => Math.max(0, current - 1)); }
    else if (event.key === 'Enter' && open) { event.preventDefault(); if (choices[activeIndex]) choose(choices[activeIndex]); }
    else if (event.key === 'Escape') { if (open) { event.preventDefault(); event.stopPropagation(); close(); } }
  };
  return <div className={`combobox${value ? ' is-active' : ''}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
    <label htmlFor={id}>{label}</label>
    <input ref={inputRef} id={id} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
      aria-activedescendant={open && choices[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
      value={open ? query : (selected?.label ?? allLabel)} placeholder={placeholder}
      onFocus={() => { setOpen(true); setActiveIndex(0); }} onClick={() => setOpen(true)}
      onChange={(event) => { setQuery(event.target.value); setOpen(true); setActiveIndex(0); }} onKeyDown={onKeyDown} />
    <ChevronDownIcon className="select-field-chevron" width={14} height={14} aria-hidden="true" />
    {open && <ul id={listId} role="listbox" className="combobox-list" aria-label={label}>
      {choices.length === 1 && query && <li className="combobox-empty" role="presentation">No matching {label.toLowerCase()}</li>}
      {choices.map((option, optionIndex) => <li key={option.value || 'all'} id={`${id}-option-${optionIndex}`} role="option"
        aria-selected={option.value === value} className={optionIndex === activeIndex ? 'is-active' : undefined}
        onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(optionIndex)} onClick={() => choose(option)}>
        {option.label}
      </li>)}
    </ul>}
  </div>;
}
