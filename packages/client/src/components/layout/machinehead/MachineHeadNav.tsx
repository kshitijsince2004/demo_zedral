import { Activity, ArrowRightLeft, FileSpreadsheet, Upload } from 'lucide-react';
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
