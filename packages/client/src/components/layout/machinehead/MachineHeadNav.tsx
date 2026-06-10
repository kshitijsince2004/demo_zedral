import { Activity, Upload } from 'lucide-react';
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
