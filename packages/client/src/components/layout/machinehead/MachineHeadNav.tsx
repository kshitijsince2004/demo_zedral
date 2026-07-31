import { useEffect } from 'react';
import {
  Activity,
  ArrowRightLeft,
  ClipboardCheck,
  FileSpreadsheet,
  FlaskConical,
  Layers,
  Scissors,
  Settings2,
  Upload,
  Users,
} from 'lucide-react';
import { DeskSideNav, type DeskNavItem } from '../shared/DeskSideNav';
import { useEffectiveSessionRole } from '../../../lib/sessionRole';
import { useOperationalMachineAccess } from '../../../lib/useOperationalMachineAccess';
import { isAnnMhDesk, useMhDeskFocus } from '../../../lib/annMhDesk';
import { isPklMhDesk, syncMhDeskFocus } from '../../../lib/pklMhDesk';

const SUPERVISOR_NAV_IDS = new Set(['live', 'order-assignment', 'crs-assignment', 'import', 'traceability']);

const ALL_NAV_ITEMS: DeskNavItem[] = [
  {
    id: 'live',
    label: 'Live Dashboard',
    icon: Activity,
    path: '/live',
    match: (p) => p === '/live' || p === '/machine-head-dashboard',
  },
  {
    id: 'crew',
    label: 'Crew Management',
    icon: Users,
    path: '/machine-head/crew',
    match: (p) => p === '/machine-head/crew',
  },
  {
    id: 'shift-review',
    label: 'Shift Review',
    icon: ClipboardCheck,
    path: '/machine-head/shift-review',
    match: (p) => p === '/machine-head/shift-review',
  },
  {
    id: 'order-assignment',
    label: 'Order Assignment',
    icon: ArrowRightLeft,
    path: '/order-assignment',
    match: (p) => p.startsWith('/order-assignment') && !p.startsWith('/crs/'),
  },
  {
    id: 'crs-assignment',
    label: 'CRS Assignment',
    icon: Scissors,
    path: '/crs/order-assignment',
    match: (p) => p.startsWith('/crs/order-assignment'),
  },
  {
    id: 'machine-specs',
    label: 'Machine Specs',
    icon: Settings2,
    path: '/admin/machine-specs',
    match: (p) => p.startsWith('/admin/machine-specs'),
  },
  {
    id: 'pkl-specs',
    label: 'PKL Specs',
    icon: FlaskConical,
    path: '/admin/pkl-specs',
    match: (p) => p.startsWith('/admin/pkl-specs'),
  },
  {
    id: 'ann-specs',
    label: 'ANN Specs',
    icon: Settings2,
    path: '/admin/ann-specs',
    match: (p) => p.startsWith('/admin/ann-specs'),
  },
  {
    id: 'dpr-export',
    label: 'Export',
    icon: FileSpreadsheet,
    path: '/machine-head/dpr-export',
    match: (p) => p === '/machine-head/dpr-export' || p.startsWith('/machine-head/exports'),
  },
  {
    id: 'import',
    label: 'Import',
    icon: Upload,
    path: '/import/rolling',
    match: (p) => p.startsWith('/import'),
  },
  {
    id: 'traceability',
    label: 'Order Tracing',
    icon: Activity,
    path: '/machine-head/traceability',
    match: (p) => p.startsWith('/machine-head/traceability'),
  },
];

/** ANN-only MH desk — plan Phase 1. */
const ANN_NAV_ITEMS: DeskNavItem[] = [
  {
    id: 'ann-live',
    label: 'Live Dashboard',
    icon: Activity,
    path: '/machine-head/ann/live',
    match: (p) =>
      p === '/machine-head/ann/live' ||
      p === '/machine-head/ann/trends' ||
      p === '/live' ||
      p === '/machine-head-dashboard',
  },
  {
    id: 'ann-batching',
    label: 'Ann Batching',
    icon: Layers,
    path: '/machine-head/ann/batching',
    match: (p) => p.startsWith('/machine-head/ann/batching'),
  },
  {
    id: 'crew',
    label: 'Crew Management',
    icon: Users,
    path: '/machine-head/crew',
    match: (p) => p === '/machine-head/crew',
  },
  {
    id: 'shift-review',
    label: 'Shift Review',
    icon: ClipboardCheck,
    path: '/machine-head/shift-review',
    match: (p) => p === '/machine-head/shift-review',
  },
  {
    id: 'ann-import',
    label: 'Import',
    icon: Upload,
    path: '/machine-head/ann/import',
    match: (p) => p.startsWith('/machine-head/ann/import'),
  },
  {
    id: 'dpr-export',
    label: 'Export',
    icon: FileSpreadsheet,
    path: '/machine-head/dpr-export',
    match: (p) => p === '/machine-head/dpr-export' || p.startsWith('/machine-head/exports'),
  },
  {
    id: 'traceability',
    label: 'Order Tracing',
    icon: Activity,
    path: '/machine-head/traceability',
    match: (p) => p.startsWith('/machine-head/traceability'),
  },
  {
    id: 'ann-specs',
    label: 'Ann Specs',
    icon: Settings2,
    path: '/admin/ann-specs',
    match: (p) => p.startsWith('/admin/ann-specs'),
  },
];

/** PKL-focused MH desk — Live / Crew / Review / Specs / Import / Export / Trace. */
const PKL_NAV_ITEMS: DeskNavItem[] = [
  {
    id: 'live',
    label: 'Live Dashboard',
    icon: Activity,
    path: '/live',
    match: (p) => p === '/live' || p === '/machine-head-dashboard',
  },
  {
    id: 'crew',
    label: 'Crew Management',
    icon: Users,
    path: '/machine-head/crew',
    match: (p) => p === '/machine-head/crew',
  },
  {
    id: 'shift-review',
    label: 'Shift Review',
    icon: ClipboardCheck,
    path: '/machine-head/shift-review',
    match: (p) => p === '/machine-head/shift-review',
  },
  {
    id: 'pkl-specs',
    label: 'PKL Specs',
    icon: FlaskConical,
    path: '/admin/pkl-specs',
    match: (p) => p.startsWith('/admin/pkl-specs'),
  },
  {
    id: 'import',
    label: 'Import',
    icon: Upload,
    path: '/import/rolling',
    match: (p) => p.startsWith('/import'),
  },
  {
    id: 'dpr-export',
    label: 'Export',
    icon: FileSpreadsheet,
    path: '/machine-head/dpr-export',
    match: (p) => p === '/machine-head/dpr-export' || p.startsWith('/machine-head/exports'),
  },
  {
    id: 'traceability',
    label: 'Order Tracing',
    icon: Activity,
    path: '/machine-head/traceability',
    match: (p) => p.startsWith('/machine-head/traceability'),
  },
];

export function MachineHeadNav() {
  const { role } = useEffectiveSessionRole();
  const isSupervisor = role === 'SUPERVISOR';
  const machines = useOperationalMachineAccess();
  const focus = useMhDeskFocus((s) => s.focus);
  const setFocus = useMhDeskFocus((s) => s.setFocus);

  useEffect(() => {
    syncMhDeskFocus(machines, focus, setFocus);
  }, [machines, focus, setFocus]);

  const annDesk = !isSupervisor && isAnnMhDesk(machines, focus);
  const pklDesk = !isSupervisor && !annDesk && isPklMhDesk(machines, focus);

  const items = annDesk
    ? ANN_NAV_ITEMS
    : pklDesk
      ? PKL_NAV_ITEMS
      : isSupervisor
        ? ALL_NAV_ITEMS.filter((item) => SUPERVISOR_NAV_IDS.has(item.id))
        : role
          ? ALL_NAV_ITEMS
          : ALL_NAV_ITEMS.filter((item) => SUPERVISOR_NAV_IDS.has(item.id));

  return (
    <DeskSideNav
      brandLabel={isSupervisor ? 'SUPERVISOR' : annDesk ? 'ANN MH' : pklDesk ? 'PKL MH' : 'MACHINE'}
      brandSubtitle={
        isSupervisor
          ? 'Oversight console'
          : annDesk
            ? 'Annealing desk'
            : pklDesk
              ? 'Pickling desk'
              : 'Head overview'
      }
      items={items}
      ariaLabel={isSupervisor ? 'Supervisor navigation' : 'Machine head navigation'}
    />
  );
}
