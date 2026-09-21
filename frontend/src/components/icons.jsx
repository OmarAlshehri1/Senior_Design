// Minimal inline SVG icon set (stroke-based, matches a clean SaaS dashboard style).

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
};

export const ShieldIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

export const GridIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </svg>
);

export const ListIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3 6h.01M3 12h.01M3 18h.01" />
  </svg>
);

export const AlertIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 9v4M12 17h.01" />
    <path d="M10.29 3.86l-8.18 14.18A1.5 1.5 0 0 0 3.5 20.5h17a1.5 1.5 0 0 0 1.39-2.46L13.71 3.86a1.5 1.5 0 0 0-2.42 0z" />
  </svg>
);

export const CheckShieldIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

export const ReportIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M14 3v5h5" />
    <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M8 13h8M8 17h8M8 9h3" />
  </svg>
);

export const SettingsIcon = (p) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.04 1.56V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.36a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.64 15a1.7 1.7 0 0 0-1.56-1.04H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.64 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.64a1.7 1.7 0 0 0 1.04-1.56V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1.04 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.36 9a1.7 1.7 0 0 0 1.56 1.04H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.56 1.04z" />
  </svg>
);

export const RefreshIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </svg>
);

export const BellIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M6 8a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

export const DocIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M14 3v5h5" />
    <path d="M6 3h8l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
  </svg>
);

export const ClipboardCheckIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="6" y="4" width="12" height="16" rx="1.5" />
    <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
    <path d="M9 13l2 2 4-4" />
  </svg>
);

export const TriangleAlertIcon = AlertIcon;

export const GaugeIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M4 14a8 8 0 1 1 16 0" />
    <path d="M12 14l4-4" />
    <path d="M12 18h.01" />
  </svg>
);

export const SearchIcon = (p) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
);

export const DuplicateIcon = (p) => (
  <svg {...base} {...p}>
    <rect x="8" y="8" width="12" height="12" rx="1.5" />
    <path d="M4 16V5a1 1 0 0 1 1-1h11" />
  </svg>
);

export const SplitIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M6 3v6c0 3 2 4 6 6s6 3 6 6" />
    <path d="M18 3v6c0 3-2 4-6 6" />
  </svg>
);

export const GhostIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M5 20V11a7 7 0 0 1 14 0v9l-2.5-2-2 2-2.5-2-2 2-2.5-2L5 20z" />
    <path d="M9 11h.01M15 11h.01" />
  </svg>
);

export const UsersIcon = (p) => (
  <svg {...base} {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
    <circle cx="17" cy="9" r="2.6" />
    <path d="M21 20c0-2.6-1.7-4.8-4-5.6" />
  </svg>
);

export const LimitIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M4 19h16" />
    <path d="M7 19V9M12 19V5M17 19v-7" />
  </svg>
);

export const ArrowLeftIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M19 12H5" />
    <path d="M11 18l-6-6 6-6" />
  </svg>
);

export const MenuIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);

export const XIcon = (p) => (
  <svg {...base} {...p}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);
