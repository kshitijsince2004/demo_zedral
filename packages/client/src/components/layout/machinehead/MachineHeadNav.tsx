import { useEffect } from 'react';
import {
  BarChart3,
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
import {
  hrsPklAssigned,
  importPathForLine,
  isHrsMhDesk,
  isHrsPklMhDesk,
  isPklMhDesk,
  resolveImportableAssignedLines,
  syncMhDeskFocus,
  type ImportableLine,
} from '../../../lib/pklMhDesk';
import { isRwdMhDesk, resolveRwdLiveLine, rwdAssigned } from '../../../lib/rwdMhDesk';
import { navItemsForMachines } from '../../../lib/mhLineCapabilities';

const SUPERVISOR_NAV_IDS = new Set(['live', 'order-assignment', 'crs-assignment', 'import', 'traceability']);

const IMPORT_LABEL: Record<ImportableLine, string> = {
  HRS: 'HRS',
  PKL: 'PKL',
  ANN: 'ANN',
  RWD: 'RWD',
  ROLLING: 'Rolling',
};

/** Line-scoped Import item(s) for MH desks — one per assigned importable process. */
function lineScopedImportItems(lines: ImportableLine[]): DeskNavItem[] {
  return lines.map((line) => ({
    id: lines.length === 1 ? 'import' : `import-${line.toLowerCase()}`,
    label: lines.length === 1 ? 'Import' : `Import ${IMPORT_LABEL[line]}`,
    icon: Upload,
    path: importPathForLine(line),
    match: (p: string) =>
      p.startsWith(importPathForLine(line))
      || (line === 'ROLLING' && (p.startsWith('/machine-head/6hi/import')
        || p.startsWith('/machine-head/4hi/import')
        || p.startsWith('/machine-head/2hi/import')
        || p.startsWith('/import/rolling'))),
  }));
}

/** Replace plant-wide Import with line-scoped items when MH has importable lines. */
function withLineScopedImports(items: DeskNavItem[], machines: string[]): DeskNavItem[] {
  const lines = resolveImportableAssignedLines(machines);
  if (lines.length === 0) return items;
  const importItems = lineScopedImportItems(lines);
  let inserted = false;
  const out: DeskNavItem[] = [];
  for (const item of items) {
    if (item.id === 'import' || item.id.startsWith('import-')) {
      if (!inserted) {
        out.push(...importItems);
        inserted = true;
      }
      continue;
    }
    out.push(item);
  }
  if (!inserted) out.push(...importItems);
  return out;
}

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
    path: '/machine-head/pkl/specs',
    match: (p) => p.startsWith('/machine-head/pkl/specs'),
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
    id: 'ann-report',
    label: 'Report',
    icon: BarChart3,
    path: '/machine-head/ann/report',
    match: (p) => p === '/machine-head/ann/report',
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

/** Shared HRS/PKL MH items — specs appended only for PKL. */
function hrsPklNavItems(line: 'HRS' | 'PKL'): DeskNavItem[] {
  const livePath = line === 'PKL' ? '/machine-head/pkl/live' : '/machine-head/hrs/live';
  const base: DeskNavItem[] = [
    {
      id: 'live',
      label: 'Live Dashboard',
      icon: Activity,
      path: livePath,
      match: (p) =>
        p === '/live'
        || p === '/machine-head-dashboard'
        || p.startsWith('/machine-head/pkl/live')
        || p.startsWith('/machine-head/pkl/coil')
        || p.startsWith('/machine-head/hrs/live')
        || p.startsWith('/machine-head/hrs/coil'),
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
  ];
  if (line === 'PKL') {
    base.push({
      id: 'pkl-specs',
      label: 'PKL Specs',
      icon: FlaskConical,
      path: '/machine-head/pkl/specs',
      match: (p) => p.startsWith('/machine-head/pkl/specs'),
    });
  }
  base.push(
    {
      id: 'import',
      label: 'Import',
      icon: Upload,
      path: line === 'PKL' ? '/machine-head/pkl/import' : '/machine-head/hrs/import',
      match: (p) =>
        p.startsWith('/machine-head/hrs/import')
        || p.startsWith('/machine-head/pkl/import')
        || p.startsWith('/import'),
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
  );
  return base;
}

/** Rewinding MH desk — live + assignment + import/export. */
const RWD_NAV_ITEMS: DeskNavItem[] = [
  {
    id: 'rwd-live',
    label: 'Live Dashboard',
    icon: Activity,
    path: '/machine-head/rwd/live',
    match: (p) =>
      p === '/machine-head/rwd/live' ||
      p.startsWith('/machine-head/rwd'),
  },
  {
    id: 'order-assignment',
    label: 'Order Assignment',
    icon: ArrowRightLeft,
    path: '/order-assignment',
    match: (p) => p.startsWith('/order-assignment') && !p.startsWith('/crs/'),
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
    id: 'import',
    label: 'Import',
    icon: Upload,
    path: '/machine-head/rwd/import',
    match: (p) => p.startsWith('/machine-head/rwd/import') || p.startsWith('/import'),
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

function LineToggle({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  if (options.length < 2) return null;
  return (
    <div className="flex rounded-lg bg-white/10 p-0.5 ring-1 ring-white/15" role="group" aria-label="Desk line">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={[
            'flex-1 py-1.5 text-[11px] font-bold uppercase tracking-wide rounded-md transition-colors',
            value === opt ? 'bg-white text-primary' : 'text-white/70 hover:text-white',
          ].join(' ')}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

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
  const rwdDesk = !isSupervisor && !annDesk && isRwdMhDesk(machines, focus);
  const pair = hrsPklAssigned(machines);
  const rwdPair = rwdAssigned(machines);
  const combined = !isSupervisor && !annDesk && !rwdDesk && isHrsPklMhDesk(machines, focus);
  const hrsDesk = !isSupervisor && !annDesk && !rwdDesk && !combined && isHrsMhDesk(machines, focus);
  const pklDesk = !isSupervisor && !annDesk && !rwdDesk && !combined && isPklMhDesk(machines, focus);
  const lineFocus: 'HRS' | 'PKL' = focus?.toUpperCase() === 'PKL' ? 'PKL' : 'HRS';
  const rwdLine = resolveRwdLiveLine(machines, focus);

  const deskLine: 'HRS' | 'PKL' | null = combined
    ? lineFocus
    : hrsDesk
      ? 'HRS'
      : pklDesk
        ? 'PKL'
        : null;

  const items = annDesk
    ? ANN_NAV_ITEMS
    : rwdDesk
      ? RWD_NAV_ITEMS
    : deskLine
      ? hrsPklNavItems(deskLine)
      : isSupervisor
        ? ALL_NAV_ITEMS.filter((item) => SUPERVISOR_NAV_IDS.has(item.id))
        : role
          // CRS/CTL/CRM/mixed fallback — union of assigned lines only (no specs leak).
          ? withLineScopedImports(navItemsForMachines(machines), machines)
          : ALL_NAV_ITEMS.filter((item) => SUPERVISOR_NAV_IDS.has(item.id));

  const brandLabel = isSupervisor
    ? 'SUPERVISOR'
    : annDesk
      ? 'ANN MH'
      : rwdDesk
        ? `${rwdLine} MH`
      : deskLine
        ? `${deskLine} MH`
        : 'MACHINE';

  return (
    <DeskSideNav
      brandLabel={brandLabel}
      brandSubtitle={
        isSupervisor
          ? 'Oversight console'
          : annDesk
            ? 'Annealing desk'
            : rwdDesk
              ? 'Rewinding desk'
            : deskLine
              ? deskLine === 'HRS' ? 'HR Slitting desk' : 'Pickling desk'
              : 'Head overview'
      }
      brandAccessory={
        combined ? (
          <LineToggle
            options={pair}
            value={lineFocus}
            onChange={(v) => {
              setFocus(v);
              window.location.assign(v === 'PKL' ? '/machine-head/pkl/live' : '/live');
            }}
          />
        ) : rwdDesk && rwdPair.length > 1 ? (
          <LineToggle
            options={rwdPair}
            value={rwdLine}
            onChange={(v) => {
              setFocus(v);
              // Both RWD and 2HI stay on rewinding MH live (not CRM /live).
              window.location.assign('/machine-head/rwd/live');
            }}
          />
        ) : undefined
      }
      items={items}
      ariaLabel={isSupervisor ? 'Supervisor navigation' : 'Machine head navigation'}
    />
  );
}
