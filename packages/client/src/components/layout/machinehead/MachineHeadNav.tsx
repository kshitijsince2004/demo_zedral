import { Activity, ArrowRightLeft, FileSpreadsheet, Upload, ClipboardCheck } from 'lucide-react';
import { Users } from 'lucide-react';
import { DeskSideNav, type DeskNavItem } from '../shared/DeskSideNav';

const NAV_ITEMS: DeskNavItem[] = [
  {
    id: 'live',
    label: 'Live Dashboard',
    icon: Activity,
    path: '/machine-head-dashboard',
    match: (p) => p === '/machine-head-dashboard',
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
    match: (p) => p.startsWith('/order-assignment'),
  },
  {
    id: 'dpr-export',
    label: 'DPR Export',
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
    icon: Activity, // Reuse an icon or import a specific one like Search, but Activity is already imported
    path: '/machine-head/traceability',
    match: (p) => p.startsWith('/machine-head/traceability'),
  },
];

export function MachineHeadNav() {
  return (
    <DeskSideNav
      brandLabel="MACHINE"
      brandSubtitle="Head overview"
      items={NAV_ITEMS}
      ariaLabel="Machine head navigation"
    />
  );
}
