import React from 'react';
import type { MachineStatusCard, MachineLiveStatus } from '@m1/shared-validation';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { AlertTriangle, Clock, Cpu, ShieldAlert, User, Wrench } from 'lucide-react';

function formatUpdatedAt(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

type StatusCfg = {
  headerBg: string;
  headerText: string;
  badgeBg: string;
  badgeText: string;
  dotClass: string;
  label: string;
};

const STATUS_CFG: Record<MachineLiveStatus, StatusCfg> = {
  RUNNING: {
    headerBg: 'bg-emerald-600',
    headerText: 'text-white',
    badgeBg: 'bg-white/20',
    badgeText: 'text-white',
    dotClass: 'bg-white animate-pulse',
    label: 'Running',
  },
  IDLE: {
    headerBg: 'bg-slate-500',
    headerText: 'text-white',
    badgeBg: 'bg-white/20',
    badgeText: 'text-white',
    dotClass: 'bg-slate-300',
    label: 'Idle',
  },
  STOPPAGE: {
    headerBg: 'bg-amber-500',
    headerText: 'text-white',
    badgeBg: 'bg-white/20',
    badgeText: 'text-white',
    dotClass: 'bg-white animate-pulse',
    label: 'Stoppage',
  },
  BREAKDOWN: {
    headerBg: 'bg-red-600',
    headerText: 'text-white',
    badgeBg: 'bg-white/20',
    badgeText: 'text-white',
    dotClass: 'bg-white animate-pulse',
    label: 'Breakdown',
  },
  MAINTENANCE: {
    headerBg: 'bg-blue-600',
    headerText: 'text-white',
    badgeBg: 'bg-white/20',
    badgeText: 'text-white',
    dotClass: 'bg-white',
    label: 'Maintenance',
  },
};

function RunningStateInfo({ m }: { m: MachineStatusCard }) {
  const { formatted } = useLiveTimer(m.stateSinceAt, m.status === 'RUNNING');

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-mono font-bold text-emerald-600 tracking-tight">{formatted}</span>
        <span className="text-[9px] font-bold uppercase tracking-widest text-emerald-500">Runtime</span>
      </div>

      <div className="bg-emerald-50 rounded-lg px-3 py-2.5 border border-emerald-100">
        <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-600 mb-1">Current Order</div>
        <div className="font-bold text-sm text-foreground leading-tight">{m.currentOrder || '—'}</div>
        {m.currentCoil && (
          <div className="text-[11px] text-muted-foreground font-mono mt-1">Coil {m.currentCoil}</div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-50 rounded-lg px-2.5 py-2 border border-border/50">
          <div className="flex items-center gap-1 mb-0.5">
            <User className="w-3 h-3 text-muted-foreground" />
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold">Operator</span>
          </div>
          <div className="text-xs font-semibold text-foreground truncate">{m.currentOperator || '—'}</div>
        </div>
        <div className="bg-slate-50 rounded-lg px-2.5 py-2 border border-border/50">
          <div className="flex items-center gap-1 mb-0.5">
            <Clock className="w-3 h-3 text-muted-foreground" />
            <span className="text-[9px] text-muted-foreground uppercase tracking-wide font-semibold">Shift</span>
          </div>
          <div className="text-xs font-semibold text-foreground">{m.shiftCode || '—'}</div>
        </div>
      </div>

      {m.productionWeightMt != null && (
        <div className="bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-100">
          <div className="text-[9px] font-bold uppercase tracking-widest text-emerald-600 mb-0.5">Produced (shift)</div>
          <div className="text-sm font-bold text-emerald-700">{m.productionWeightMt} MT</div>
        </div>
      )}
    </div>
  );
}

function IdleStateInfo({ m }: { m: MachineStatusCard }) {
  const { formatted } = useLiveTimer(m.stateSinceAt, !!m.stateSinceAt);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-mono font-bold text-slate-500 tracking-tight">
          {m.stateSinceAt ? formatted : '—'}
        </span>
        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Idle For</span>
      </div>
      <div className="grid grid-cols-1 gap-2">
        <div className="bg-slate-50 rounded-lg px-3 py-2 border border-border/50">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Last Order</div>
          <div className="text-xs font-medium text-foreground">{m.lastOrderBatchNumber || '—'}</div>
        </div>
        <div className="bg-slate-50 rounded-lg px-3 py-2 border border-border/50">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Last Operator</div>
          <div className="text-xs font-medium text-foreground">{m.lastOperatorName || '—'}</div>
        </div>
      </div>
    </div>
  );
}

function StoppageStateInfo({ m, isDefect = false }: { m: MachineStatusCard; isDefect?: boolean }) {
  const { formatted } = useLiveTimer(m.stateSinceAt, !!m.stateSinceAt);
  const colorClass = isDefect ? 'text-red-600' : 'text-amber-600';
  const bgClass = isDefect ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className={`text-2xl font-mono font-bold tracking-tight ${colorClass}`}>{formatted}</span>
        <span className={`text-[9px] font-bold uppercase tracking-widest ${colorClass}`}>
          {isDefect ? 'Down' : 'Stopped'}
        </span>
      </div>

      <div className={`rounded-lg px-3 py-2.5 border ${bgClass}`}>
        <div className="flex items-center gap-1.5 mb-1">
          {isDefect
            ? <ShieldAlert className={`w-3.5 h-3.5 ${colorClass}`} />
            : <AlertTriangle className={`w-3.5 h-3.5 ${colorClass}`} />}
          <span className={`text-[9px] font-bold uppercase tracking-wide ${colorClass}`}>Reason</span>
        </div>
        <div className="text-sm font-semibold text-foreground">{m.activeStoppageReason || '—'}</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {m.currentOrder && (
          <div className="bg-slate-50 rounded-lg px-2.5 py-2 border border-border/50 col-span-2">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Order</div>
            <div className="text-xs font-mono font-bold text-foreground">{m.currentOrder}</div>
          </div>
        )}
        <div className="bg-slate-50 rounded-lg px-2.5 py-2 border border-border/50">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Since</div>
          <div className="text-xs font-medium text-foreground">{formatUpdatedAt(m.stateSinceAt)}</div>
        </div>
      </div>
    </div>
  );
}

function MaintenanceStateInfo({ m }: { m: MachineStatusCard }) {
  const { formatted } = useLiveTimer(m.stateSinceAt, !!m.stateSinceAt);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className="text-2xl font-mono font-bold text-blue-600 tracking-tight">
          {m.stateSinceAt ? formatted : '—'}
        </span>
        <span className="text-[9px] font-bold uppercase tracking-widest text-blue-500">In Maint.</span>
      </div>
      <div className="bg-blue-50 rounded-lg px-3 py-2.5 border border-blue-100">
        <div className="flex items-center gap-1.5 mb-1">
          <Wrench className="w-3.5 h-3.5 text-blue-500" />
          <span className="text-[9px] font-bold uppercase tracking-wide text-blue-600">Maintenance</span>
        </div>
        <div className="text-xs text-muted-foreground">{m.lastOrderBatchNumber ? `Last order: ${m.lastOrderBatchNumber}` : 'Scheduled maintenance'}</div>
      </div>
    </div>
  );
}

interface MachineStatusBoardProps {
  machines: MachineStatusCard[];
  onSelect?: (machineCode: string) => void;
}

export function MachineStatusBoard({ machines, onSelect }: MachineStatusBoardProps) {
  if (machines.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-10 text-center border border-dashed border-border rounded-2xl bg-white flex flex-col items-center gap-2">
        <Cpu className="w-8 h-8 text-muted-foreground/40" />
        <span>No machines in scope</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {machines.map((m) => {
        const cfg = STATUS_CFG[m.status] ?? STATUS_CFG.IDLE;

        return (
          <button
            key={m.machineCode}
            type="button"
            onClick={() => onSelect?.(m.machineCode)}
            className="border border-border rounded-2xl bg-white shadow-sm flex flex-col text-left transition-all hover:shadow-md hover:border-primary/30 overflow-hidden"
          >
            {/* Header */}
            <div className={`px-4 py-3 flex items-center justify-between ${cfg.headerBg}`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${cfg.dotClass}`} />
                <span className={`font-bold text-sm tracking-wide ${cfg.headerText}`}>{m.machineName}</span>
              </div>
              <span className={`text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${cfg.badgeBg} ${cfg.badgeText}`}>
                {cfg.label}
              </span>
            </div>

            {/* Body */}
            <div className="p-4 flex-1 flex flex-col">
              {m.status === 'RUNNING' && <RunningStateInfo m={m} />}
              {m.status === 'IDLE' && <IdleStateInfo m={m} />}
              {m.status === 'STOPPAGE' && <StoppageStateInfo m={m} isDefect={false} />}
              {m.status === 'BREAKDOWN' && <StoppageStateInfo m={m} isDefect={true} />}
              {m.status === 'MAINTENANCE' && <MaintenanceStateInfo m={m} />}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 border-t border-border/50 flex items-center justify-between bg-slate-50/60">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{m.machineCode}</span>
              <span className="text-[10px] text-muted-foreground">
                Updated {formatUpdatedAt(m.lastUpdateAt ?? m.stateSinceAt)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
