import { Database, Settings2, Shield, Upload, Users } from 'lucide-react';
import { DeskSideNav, type DeskNavItem } from '../shared/DeskSideNav';

const NAV_ITEMS: DeskNavItem[] = [
  {
    id: 'master',
    label: 'Master Data',
    icon: Database,
    path: '/admin/master-data',
    match: (p) => p === '/admin/master-data',
  },
  {
    id: 'planning',
    label: 'Planning',
    icon: Upload,
    path: '/admin/planning',
    match: (p) => p === '/admin/planning',
  },
  {
    id: 'users',
    label: 'Users',
    icon: Users,
    path: '/admin/users',
    match: (p) => p === '/admin/users',
  },
  {
    id: 'audit',
    label: 'Audit Trail',
    icon: Shield,
    path: '/admin/audit',
    match: (p) => p === '/admin/audit' || p.startsWith('/admin/audit/'),
  },
  {
    id: 'system',
    label: 'System',
    icon: Settings2,
    path: '/admin/system',
    match: (p) => p === '/admin/system',
  },
  {
    id: 'validation-rules',
    label: 'Validation Rules',
    icon: Database,
    path: '/admin/validation-rules',
    match: (p) => p === '/admin/validation-rules',
  },
];

export function AdminNav() {
  return (
    <DeskSideNav
      brandLabel="ADMIN"
      brandSubtitle="System configuration"
      items={NAV_ITEMS}
      ariaLabel="Admin configuration navigation"
    />
  );
}
