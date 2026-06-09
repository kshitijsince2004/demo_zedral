import type { MachineStatusCard, MachineLiveStatus } from '@m1/shared-validation';
import { useElapsedTimer } from '../../hooks/useElapsedTimer';

// ── Color palettes by state ──────────────────────────────────────────────────
const STATE_CONFIG: Record<
  MachineLiveStatus,
  { border: string; headerBg: string; badge: string; dot: string; label: string }
> = {
  RUNNING: {
    border: 'border-emerald-400',
    headerBg: 'bg-emerald-500',
    badge: 'bg-emerald-100 text-emerald-700',
    dot: 'bg-emerald-400 animate-pulse',
    label: 'RUNNING',
  },
  IDLE: {
    border: 'border-slate-300',
    headerBg: 'bg-slate-400',
    badge: 'bg-slate-100 text-slate-600',
    dot: 'bg-slate-400',
    label: 'IDLE',
  },
  STOPPAGE: {
    border: 'border-amber-400',
    headerBg: 'bg-amber-500',
    badge: 'bg-amber-100 text-amber-700',
    dot: 'bg-amber-400 animate-pulse',
    label: 'STOPPAGE',
  },
  BREAKDOWN: {
    border: 'border-red-500',
    headerBg: 'bg-red-600',
    badge: 'bg-red-100 text-red-700',
    dot: 'bg-red-500 animate-pulse',
    label: 'BREAKDOWN',
  },
  MAINTENANCE: {
    border: 'border-blue-400',
    headerBg: 'bg-blue-500',
    badge: 'bg-blue-100 text-blue-700',
    dot: 'bg-blue-400',
    label: 'MAINTENANCE',
  },
};

// ── Individual state card bodies ─────────────────────────────────────────────

function RunningBody({ card }: { card: MachineStatusCard }) {
  const timer = useElapsedTimer(card.stateSinceAt);
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-2xl font-bold text-emerald-600 tabular-nums">{timer}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Runtime</span>
      </div>
      <div className="bg-emerald-50 rounded-xl px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 mb-0.5">Current Order</p>
        <p className="text-sm font-mono font-semibold text-foreground truncate">{card.currentOrder ?? '—'}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="block text-muted-foreground">Operator</span>
          <span className="font-semibold text-foreground truncate">{card.currentOperator ?? '—'}</span>
        </div>
        <div>
          <span className="block text-muted-foreground">Shift</span>
          <span className="font-semibold text-foreground">{card.shiftCode ?? '—'}</span>
        </div>
        {card.productionWeightMt != null && (
          <div className="col-span-1">
            <span className="block text-muted-foreground">Produced</span>
            <span className="font-semibold text-emerald-600">{card.productionWeightMt} MT</span>
          </div>
        )}
        {(card.rejectedCount ?? 0) > 0 && (
          <div className="col-span-1">
            <span className="block text-muted-foreground">Rejected</span>
            <span className="font-semibold text-destructive">
              {card.rejectedCount} ({card.rejectedWeightMt?.toFixed(1) ?? 0} MT)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function IdleBody({ card }: { card: MachineStatusCard }) {
  const timer = useElapsedTimer(card.stateSinceAt);
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-2xl font-bold text-slate-500 tabular-nums">{timer}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Idle For</span>
      </div>
      <div className="grid grid-cols-1 gap-2 text-xs">
        <div>
          <span className="block text-muted-foreground">Last Order</span>
          <span className="font-semibold font-mono text-foreground">{card.lastOrderBatchNumber ?? '—'}</span>
        </div>
        <div>
          <span className="block text-muted-foreground">Last Operator</span>
          <span className="font-semibold text-foreground">{card.lastOperatorName ?? '—'}</span>
        </div>
      </div>
    </div>
  );
}

function StoppageBody({ card }: { card: MachineStatusCard }) {
  const timer = useElapsedTimer(card.stateSinceAt);
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-2xl font-bold text-amber-600 tabular-nums">{timer}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Stopped For</span>
      </div>
      <div className="bg-amber-50 rounded-xl px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400 mb-0.5">Reason</p>
        <p className="text-sm font-semibold text-amber-800 truncate">
          {card.activeStoppageReason ?? 'Unknown'}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="block text-muted-foreground">Order</span>
          <span className="font-mono font-semibold text-foreground truncate">{card.currentOrder ?? '—'}</span>
        </div>
        <div>
          <span className="block text-muted-foreground">Operator</span>
          <span className="font-semibold text-foreground truncate">{card.currentOperator ?? '—'}</span>
        </div>
        {(card.rejectedCount ?? 0) > 0 && (
          <div className="col-span-2 pt-2 mt-1 border-t border-amber-200">
            <span className="block text-muted-foreground">Shift Rejects</span>
            <span className="font-semibold text-destructive">
              {card.rejectedCount} ({card.rejectedWeightMt?.toFixed(1) ?? 0} MT)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function MaintenanceBody({ card }: { card: MachineStatusCard }) {
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-blue-400" />
        <span className="text-sm font-semibold text-blue-700">Under Maintenance</span>
      </div>
      <div className="grid grid-cols-1 gap-2 text-xs">
        <div>
          <span className="block text-muted-foreground">Last Order</span>
          <span className="font-mono font-semibold text-foreground">{card.currentOrder ?? '—'}</span>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

interface MachineStatusBoardProps {
  machines: MachineStatusCard[];
  onSelect?: (machineCode: string) => void;
}

export function MachineStatusBoard({ machines, onSelect }: MachineStatusBoardProps) {
  if (machines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-10 text-center border-2 border-dashed border-border/50 rounded-3xl bg-secondary/30 backdrop-blur-sm">
        No machines in scope
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
      {machines.map((m) => {
        const cfg = STATE_CONFIG[m.status] ?? STATE_CONFIG.IDLE;
        return (
          <button
            key={m.machineCode}
            type="button"
            id={`machine-card-${m.machineCode}`}
            onClick={() => onSelect?.(m.machineCode)}
            className={`group relative border-2 ${cfg.border} rounded-2xl bg-white shadow-sm flex flex-col text-left transition-all duration-300 hover:shadow-xl hover:-translate-y-1 overflow-hidden`}
          >
            {/* Header strip */}
            <div className={`${cfg.headerBg} px-4 py-3 flex items-center justify-between`}>
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot}`} />
                <span className="font-extrabold text-base text-white tracking-tight truncate">
                  {m.machineName}
                </span>
              </div>
              <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${cfg.badge}`}>
                {cfg.label}
              </span>
            </div>

            {/* State-specific body */}
            {m.status === 'RUNNING' && <RunningBody card={m} />}
            {m.status === 'IDLE' && <IdleBody card={m} />}
            {(m.status === 'STOPPAGE' || m.status === 'BREAKDOWN') && <StoppageBody card={m} />}
            {m.status === 'MAINTENANCE' && <MaintenanceBody card={m} />}

            {/* Footer */}
            <div className="mt-auto px-4 py-2 bg-muted/10 border-t border-border/50 flex justify-between items-center text-[10px] text-muted-foreground font-medium">
              <span>{m.processCode ?? m.machineCode}</span>
              <span className="flex items-center gap-1">
                <span className="opacity-60">Updated</span>
                {m.lastUpdateAt ? new Date(m.lastUpdateAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
