import {
  Activity,
  ArrowRightLeft,
  BarChart3,
  ClipboardCheck,
  FileSpreadsheet,
  FlaskConical,
  Layers,
  Scissors,
  Settings2,
  Upload,
  Users,
} from 'lucide-react';
import type { DeskNavItem } from '../components/layout/shared/DeskSideNav';

/** Line codes that contribute MH nav capabilities (fallback desk only). */
export type MhCapabilityLine =
  | 'HRS'
  | 'PKL'
  | 'ANN'
  | 'RWD'
  | 'CRS'
  | 'CTL'
  | '6HI'
  | '4HI'
  | '2HI';

/** Fixed display order for ordered union (ids may be absent for a given assignment). */
export const NAV_DISPLAY_ORDER = [
  'live',
  'ann-live',
  'rwd-live',
  'ann-batching',
  'ann-report',
  'order-assignment',
  'crs-assignment',
  'crew',
  'shift-review',
  'machine-specs',
  'pkl-specs',
  'ann-specs',
  'import',
  'ann-import',
  'dpr-export',
  'traceability',
] as const;

export type DeskNavItemId = (typeof NAV_DISPLAY_ORDER)[number];

/** Canonical MH nav item catalogue — one definition per id. */
export const NAV_CATALOGUE: Record<DeskNavItemId, DeskNavItem> = {
  live: {
    id: 'live',
    label: 'Live Dashboard',
    icon: Activity,
    path: '/live',
    match: (p) => p === '/live' || p === '/machine-head-dashboard',
  },
  'ann-live': {
    id: 'ann-live',
    label: 'Live Dashboard',
    icon: Activity,
    path: '/machine-head/ann/live',
    match: (p) =>
      p === '/machine-head/ann/live'
      || p === '/machine-head/ann/trends'
      || p === '/live'
      || p === '/machine-head-dashboard',
  },
  'rwd-live': {
    id: 'rwd-live',
    label: 'Live Dashboard',
    icon: Activity,
    path: '/machine-head/rwd/live',
    match: (p) => p === '/machine-head/rwd/live' || p.startsWith('/machine-head/rwd'),
  },
  'ann-batching': {
    id: 'ann-batching',
    label: 'Ann Batching',
    icon: Layers,
    path: '/machine-head/ann/batching',
    match: (p) => p.startsWith('/machine-head/ann/batching'),
  },
  'ann-report': {
    id: 'ann-report',
    label: 'Report',
    icon: BarChart3,
    path: '/machine-head/ann/report',
    match: (p) => p === '/machine-head/ann/report',
  },
  'order-assignment': {
    id: 'order-assignment',
    label: 'Order Assignment',
    icon: ArrowRightLeft,
    path: '/order-assignment',
    match: (p) => p.startsWith('/order-assignment') && !p.startsWith('/crs/'),
  },
  'crs-assignment': {
    id: 'crs-assignment',
    label: 'CRS Assignment',
    icon: Scissors,
    path: '/crs/order-assignment',
    match: (p) => p.startsWith('/crs/order-assignment'),
  },
  crew: {
    id: 'crew',
    label: 'Crew Management',
    icon: Users,
    path: '/machine-head/crew',
    match: (p) => p === '/machine-head/crew',
  },
  'shift-review': {
    id: 'shift-review',
    label: 'Shift Review',
    icon: ClipboardCheck,
    path: '/machine-head/shift-review',
    match: (p) => p === '/machine-head/shift-review',
  },
  'machine-specs': {
    id: 'machine-specs',
    label: 'Machine Specs',
    icon: Settings2,
    path: '/admin/machine-specs',
    match: (p) => p.startsWith('/admin/machine-specs'),
  },
  'pkl-specs': {
    id: 'pkl-specs',
    label: 'PKL Specs',
    icon: FlaskConical,
    path: '/machine-head/pkl/specs',
    match: (p) => p.startsWith('/machine-head/pkl/specs'),
  },
  'ann-specs': {
    id: 'ann-specs',
    label: 'ANN Specs',
    icon: Settings2,
    path: '/admin/ann-specs',
    match: (p) => p.startsWith('/admin/ann-specs'),
  },
  import: {
    id: 'import',
    label: 'Import',
    icon: Upload,
    path: '/import/rolling',
    match: (p) => p.startsWith('/import'),
  },
  'ann-import': {
    id: 'ann-import',
    label: 'Import',
    icon: Upload,
    path: '/machine-head/ann/import',
    match: (p) => p.startsWith('/machine-head/ann/import'),
  },
  'dpr-export': {
    id: 'dpr-export',
    label: 'Export',
    icon: FileSpreadsheet,
    path: '/machine-head/dpr-export',
    match: (p) => p === '/machine-head/dpr-export' || p.startsWith('/machine-head/exports'),
  },
  traceability: {
    id: 'traceability',
    label: 'Order Tracing',
    icon: Activity,
    path: '/machine-head/traceability',
    match: (p) => p.startsWith('/machine-head/traceability'),
  },
};

const SHARED = ['live', 'crew', 'shift-review', 'import', 'dpr-export', 'traceability'] as const satisfies DeskNavItemId[];

/** Line code → nav item ids that line contributes (fallback MH menu). */
export const LINE_NAV: Record<MhCapabilityLine, DeskNavItemId[]> = {
  HRS: [...SHARED],
  PKL: [...SHARED, 'pkl-specs'],
  ANN: [
    'ann-live',
    'ann-batching',
    'ann-report',
    'crew',
    'shift-review',
    'ann-import',
    'dpr-export',
    'traceability',
    'ann-specs',
  ],
  RWD: ['rwd-live', 'order-assignment', 'crew', 'shift-review', 'import', 'dpr-export', 'traceability'],
  CRS: ['live', 'crs-assignment', 'crew', 'shift-review', 'import', 'dpr-export', 'traceability'],
  CTL: [...SHARED],
  '6HI': ['live', 'order-assignment', 'machine-specs', 'import', 'dpr-export', 'traceability'],
  '4HI': ['live', 'order-assignment', 'machine-specs', 'import', 'dpr-export', 'traceability'],
  '2HI': ['rwd-live', 'order-assignment', 'crew', 'shift-review', 'import', 'dpr-export', 'traceability'],
};

function isCapabilityLine(code: string): code is MhCapabilityLine {
  return Object.prototype.hasOwnProperty.call(LINE_NAV, code);
}

/** Ordered, de-duplicated nav ids for assigned machines. */
export function navIdsForMachines(machines: string[]): DeskNavItemId[] {
  const ids = new Set<DeskNavItemId>();
  for (const raw of machines) {
    const code = raw.toUpperCase();
    if (!isCapabilityLine(code)) continue;
    for (const id of LINE_NAV[code]) ids.add(id);
  }
  return NAV_DISPLAY_ORDER.filter((id) => ids.has(id));
}

/** Resolve catalogue items for the MH fallback desk (before line-scoped import rewrite). */
export function navItemsForMachines(machines: string[]): DeskNavItem[] {
  return navIdsForMachines(machines).map((id) => NAV_CATALOGUE[id]);
}
