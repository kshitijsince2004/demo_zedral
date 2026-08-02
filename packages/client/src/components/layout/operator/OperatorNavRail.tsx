import { useLocation, useNavigate } from 'react-router-dom';
import { ClipboardList, History, Layers, ListOrdered, LogOut, Plus, Table2 } from 'lucide-react';
import { useAuthStore } from '../../../lib/authStore';
import { getMachineNavItems } from '../../../lib/machineRouting';
import { useSixHiStore } from '../../../store/sixHiStore';
import { useProcessStore } from '../../../store/processStore';
import { isMillPath, millBasePath, millCodeFromPath } from '../../../lib/millPath';
import { classifyOperatorNav } from '../../../lib/classifyOperatorNav';
import { useProcessWorkspaceBase } from '../../../hooks/useProcessWorkspaceBase';
import { ProcessLineSwitcher } from '../../capture/ProcessLineSwitcher';
import ZedralLogo from '../../../assets/white logo.png';

interface OperatorNavRailProps {
  processCode: string;
  onLogout: () => void;
}

/** Operator side nav — CRM mill, PKL, or ANN process. */
export function OperatorNavRail({ processCode, onLogout }: OperatorNavRailProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { role, machineAccess, lineAccess, username, activeMachine } = useAuthStore();
  const openManualOrder = useSixHiStore((s) => s.openManualOrder);
  const requestManualCoil = useProcessStore((s) => s.requestManualCoil);
  const { basePath: processBase } = useProcessWorkspaceBase();

  const machineNav = getMachineNavItems(role, machineAccess, lineAccess, username);
  const { isProcess, isCrm, isPkl, isAnn } = classifyOperatorNav(processCode, location.pathname);

  const millBase = millBasePath(
    (activeMachine as '6HI' | '4HI' | '2HI') ?? millCodeFromPath(location.pathname) ?? '6HI',
    username && role ? { username, role } : null,
  );

  const search = location.search;
  // Never navigate to bare "/capture" (that becomes /:userScope="capture"). Fall back to first path segment.
  const scopeRoot = processBase || (() => {
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return seg ? `/${seg}` : '';
  })();
  // Generic process lines (HRS/CRS/RWD/CTL) share hub+capture on processBase — not CRM mill paths.
  const processHubItems = [
    {
      id: 'orders',
      label: 'Orders',
      icon: ListOrdered,
      path: scopeRoot || '/',
      match: (p: string) =>
        !p.includes('/capture') && !p.includes('/chart') && !p.includes('/handover') && !p.includes('/history'),
    },
    {
      id: 'capture',
      label: 'Capture',
      icon: ClipboardList,
      path: scopeRoot ? `${scopeRoot}/capture` : '/',
      match: (p: string) => p.includes('/capture'),
    },
  ] as const;

  const items = isAnn
    ? [
        {
          id: 'base',
          label: 'Base',
          icon: Layers,
          path: `${processBase || '/'}?tab=charges`,
          match: () =>
            !location.pathname.includes('/history')
            && !location.pathname.includes('/charge/')
            && (search.includes('tab=charges') || (!search.includes('tab=coils') && !location.pathname.includes('/history'))),
        },
        {
          id: 'batches',
          label: 'Batches',
          icon: ListOrdered,
          path: `${processBase || '/'}?tab=coils`,
          match: () => !location.pathname.includes('/history') && search.includes('tab=coils'),
        },
        {
          id: 'history',
          label: 'History',
          icon: History,
          path: `${processBase}/history`,
          match: () => location.pathname.includes('/history'),
        },
      ]
    : isPkl
      ? [
          ...processHubItems,
          {
            id: 'chart',
            label: 'Process Chart',
            icon: Table2,
            path: scopeRoot ? `${scopeRoot}/chart` : '/',
            match: (p: string) => p.includes('/chart'),
          },
        ]
      : isProcess
        ? [...processHubItems]
        : [
          {
            id: 'orders',
            label: 'Orders',
            icon: ListOrdered,
            path: millBase,
            match: (p: string) => isMillPath(p) && !p.includes('/capture') && !p.includes('/handover'),
          },
          {
            id: 'capture',
            label: 'Capture',
            icon: ClipboardList,
            path: `${millBase}/capture`,
            match: (p: string) => p.endsWith('/capture'),
          },
        ];

  const itemActiveClass = 'bg-white/20 text-white border border-white/30';
  const itemIdleClass = 'text-white/70 hover:text-white hover:bg-white/10 border border-transparent';
  const footerClass = 'text-white/70 hover:text-white hover:bg-white/10 border border-transparent';

  function onManual() {
    if (isProcess) {
      requestManualCoil();
      if (processBase) navigate(processBase);
      return;
    }
    openManualOrder();
  }

  return (
    <nav
      className="w-16 fixed inset-y-0 left-0 z-40 h-screen overflow-hidden border-r border-[#0f241c] bg-nav flex flex-col items-center py-3 gap-1 text-nav-foreground"
      aria-label="Operator navigation"
    >
      <div className="mb-2 px-2 py-2 flex items-center justify-center shrink-0">
        <img src={ZedralLogo} alt="Zedral" className="h-9 w-9 object-contain" />
      </div>

      <div className="flex flex-col items-center gap-1 shrink-0">
        {items.map(({ id, label, icon: Icon, path, match }) => {
          const active = match(location.pathname);
          return (
            <button
              key={id}
              type="button"
              title={label}
              onClick={() => navigate(path)}
              className={[
                'w-12 h-12 flex flex-col items-center justify-center gap-0.5 rounded-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/50',
                active ? itemActiveClass : itemIdleClass,
              ].join(' ')}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              <span className="text-[8px] uppercase tracking-wider font-medium">{label}</span>
            </button>
          );
        })}

        {!isAnn && (
          <button
            type="button"
            title={isProcess ? 'Manual Coil' : 'New Order'}
            onClick={onManual}
            className="w-12 h-12 flex flex-col items-center justify-center gap-0.5 rounded-sm transition-colors text-accent hover:bg-white/10 border border-accent/40"
          >
            <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
            <span className="text-[8px] uppercase tracking-wider font-bold">
              {isProcess ? 'Manual' : 'New'}
            </span>
          </button>
        )}
      </div>

      <div className="flex-1 min-h-4" />

      {machineNav.length > 1 && (
        <div className="px-1 pb-2 w-full hidden xl:block shrink-0">
          <ProcessLineSwitcher
            activeCode={activeMachine ?? millCodeFromPath(location.pathname) ?? processCode}
            className="flex-col items-stretch [&>button]:w-full [&>button]:text-left"
          />
        </div>
      )}

      <button
        type="button"
        title="End Session"
        onClick={onLogout}
        className={[
          'w-12 h-12 flex flex-col items-center justify-center gap-0.5 rounded-sm transition-colors shrink-0 mb-1',
          footerClass,
        ].join(' ')}
      >
        <LogOut className="h-4 w-4" strokeWidth={1.75} aria-hidden />
        <span className="text-[8px] uppercase tracking-wider font-medium leading-tight text-center">Logout</span>
      </button>
    </nav>
  );
}
