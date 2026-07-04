import { Activity, BarChart3, ClipboardList, Download, Search, Upload } from 'lucide-react';
import { DeskSideNav, type DeskNavItem } from '../shared/DeskSideNav';

const NAV_ITEMS: DeskNavItem[] = [
  {
    id: 'plant',
    label: 'Dashboard',
    icon: BarChart3,
    path: '/plant',
    match: (p) => p === '/plant',
  },
  {
    id: 'live',
    label: 'Live',
    icon: Activity,
    path: '/plant/live',
    match: (p) => p === '/plant/live' || p === '/machine-head-dashboard',
  },
  {
    id: 'import',
    label: 'Import',
    icon: Upload,
    path: '/import/rolling',
    match: (p) => p.startsWith('/import'),
  },
  {
    id: 'export',
    label: 'Export',
    icon: Download,
    path: '/reports/export',
    match: (p) => p.startsWith('/reports'),
  },
  {
    id: 'trace',
    label: 'Trace',
    icon: Search,
    path: '/trace',
    match: (p) => p === '/trace',
  },
  {
    id: 'audit',
    label: 'Audit Trail',
    icon: ClipboardList,
    path: '/audit',
    match: (p) => p === '/audit',
  },
];

export function ExecutiveNav() {
  return (
    <DeskSideNav
      brandLabel="PLANT"
      brandSubtitle="Executive overview"
      items={NAV_ITEMS}
      ariaLabel="Plant head navigation"
    />
  );
}
