import { Activity, ArrowRightLeft, ClipboardCheck, FileSpreadsheet, Upload, Users } from 'lucide-react';
import { useSessionContext } from 'supertokens-auth-react/recipe/session';
import { pickPrimaryRole } from '@m1/shared-validation';
import { DeskSideNav, type DeskNavItem } from '../shared/DeskSideNav';
import { useAuthStore } from '../../../lib/authStore';

const SUPERVISOR_NAV_IDS = new Set(['live', 'order-assignment', 'import', 'traceability']);

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
    match: (p) => p.startsWith('/order-assignment'),
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

/** Prefer JWT primary role so stale sessionStorage MACHINE_HEAD cannot show MH-only nav. */
function useEffectiveDeskRole(): string | null {
  const storeRole = useAuthStore((s) => s.role);
  const session = useSessionContext();
  if (!session.loading && session.doesSessionExist) {
    const payload = session.accessTokenPayload as Record<string, unknown>;
    const roles = Array.isArray(payload.roles) ? (payload.roles as string[]) : [];
    const jwtRole = pickPrimaryRole(roles);
    if (jwtRole) return jwtRole;
  }
  return storeRole;
}

export function MachineHeadNav() {
  const role = useEffectiveDeskRole();
  const isSupervisor = role === 'SUPERVISOR';
  const items = isSupervisor
    ? ALL_NAV_ITEMS.filter((item) => SUPERVISOR_NAV_IDS.has(item.id))
    : role
      ? ALL_NAV_ITEMS
      : ALL_NAV_ITEMS.filter((item) => SUPERVISOR_NAV_IDS.has(item.id)); // role unknown: never flash MH-only links

  return (
    <DeskSideNav
      brandLabel={isSupervisor ? 'SUPERVISOR' : 'MACHINE'}
      brandSubtitle={isSupervisor ? 'Oversight console' : 'Head overview'}
      items={items}
      ariaLabel={isSupervisor ? 'Supervisor navigation' : 'Machine head navigation'}
    />
  );
}
