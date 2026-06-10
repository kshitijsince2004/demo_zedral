import React from 'react';
import type { MachineStatusCard, MachineLiveStatus } from '@m1/shared-validation';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { toneRail, toneText, type Tone } from '../../lib/tones';

function getHeaderConfig(status: MachineLiveStatus): { bg: string; text: string; badgeText: string } {
  const toneMap: Record<MachineLiveStatus, Tone> = {
    RUNNING: 'success',
    IDLE: 'muted',
    BREAKDOWN: 'destructive',
    STOPPAGE: 'warning',
    MAINTENANCE: 'info',
  };
  const tone = toneMap[status] ?? 'muted';
  return {
    bg: toneRail[tone],
    text: 'text-white',
    badgeText: toneText[tone],
  };
}

function formatUpdatedAt(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function RunningStateInfo({ m }: { m: MachineStatusCard }) {
  const { formatted } = useLiveTimer(m.stateSinceAt, m.status === 'RUNNING');

  return (
    <>
      <div className="flex justify-between items-baseline mb-4">
        <span className="text-3xl font-mono font-bold tracking-tight text-success">{formatted}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-success">Runtime</span>
      </div>

      <div className="bg-success/10 rounded-xl p-3 mb-4">
        <div className="text-[9px] font-bold uppercase tracking-widest text-success mb-1">Current Order</div>
        <div className="font-bold text-sm text-foreground">{m.currentOrder || '—'}</div>
        {m.currentCoil && (
          <div className="text-xs text-muted-foreground mt-1 font-mono">Coil {m.currentCoil}</div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-y-3">
        <div>
          <div className="text-[11px] text-muted-foreground mb-0.5">Operator</div>
          <div className="text-xs font-bold text-foreground">{m.currentOperator || '—'}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-0.5">Shift</div>
          <div className="text-xs font-bold text-foreground">{m.shiftCode || '—'}</div>
        </div>
        <div className="col-span-2">
          <div className="text-[11px] text-muted-foreground mb-0.5">Produced</div>
          <div className="text-xs font-bold text-success">
            {m.productionWeightMt != null ? `${m.productionWeightMt} MT` : '—'}
          </div>
        </div>
      </div>
    </>
  );
}

function IdleStateInfo({ m }: { m: MachineStatusCard }) {
  const { formatted } = useLiveTimer(m.stateSinceAt, !!m.stateSinceAt);

  return (
    <>
      <div className="flex justify-between items-baseline mb-4">
        <span className="text-3xl font-mono font-bold tracking-tight text-muted-foreground">
          {m.stateSinceAt ? formatted : '—'}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Idle For</span>
      </div>

      <div className="grid grid-cols-1 gap-y-4">
        <div>
          <div className="text-[11px] text-muted-foreground mb-0.5">Last Order</div>
          <div className="text-xs font-medium text-foreground">{m.lastOrderBatchNumber || '—'}</div>
        </div>
        <div>
          <div className="text-[11px] text-muted-foreground mb-0.5">Last Operator</div>
          <div className="text-xs font-medium text-foreground">{m.lastOperatorName || '—'}</div>
        </div>
      </div>
    </>
  );
}

function StoppageStateInfo({ m, isDefect = false }: { m: MachineStatusCard; isDefect?: boolean }) {
  const { formatted } = useLiveTimer(m.stateSinceAt, !!m.stateSinceAt);
  const colorClass = isDefect ? 'text-destructive' : 'text-warning';

  return (
    <>
      <div className="flex justify-between items-baseline mb-4">
        <span className={`text-3xl font-mono font-bold tracking-tight ${colorClass}`}>{formatted}</span>
        <span className={`text-[10px] font-bold uppercase tracking-widest ${colorClass}`}>
          {isDefect ? 'Breakdown' : 'Stoppage'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-y-4">
        <div>
          <div className="text-[11px] text-muted-foreground mb-0.5">Reason</div>
          <div className="text-sm font-semibold text-foreground flex items-center gap-1.5">
            {isDefect ? <ShieldAlert className={`w-4 h-4 ${colorClass}`} /> : <AlertTriangle className={`w-4 h-4 ${colorClass}`} />}
            {m.activeStoppageReason || '—'}
          </div>
        </div>
        {m.currentOrder && (
          <div>
            <div className="text-[11px] text-muted-foreground mb-0.5">Order</div>
            <div className="text-xs font-mono font-bold text-foreground">{m.currentOrder}</div>
          </div>
        )}
        <div>
          <div className="text-[11px] text-muted-foreground mb-0.5">Since</div>
          <div className="text-xs font-medium text-foreground">{formatUpdatedAt(m.stateSinceAt)}</div>
        </div>
      </div>
    </>
  );
}

interface MachineStatusBoardProps {
  machines: MachineStatusCard[];
  onSelect?: (machineCode: string) => void;
}

export function MachineStatusBoard({ machines, onSelect }: MachineStatusBoardProps) {
  if (machines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center border border-dashed border-border rounded-2xl bg-white">
        No machines in scope
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
      {machines.map((m) => {
        const header = getHeaderConfig(m.status);
        const isRunning = m.status === 'RUNNING';

        return (
          <button
            key={m.machineCode}
            type="button"
            onClick={() => onSelect?.(m.machineCode)}
            className="border border-border rounded-2xl bg-white shadow-sm flex flex-col text-left transition-all hover:shadow-md hover:border-primary/40 overflow-hidden relative min-h-[320px]"
          >
            <div className={`px-4 py-3 flex items-center justify-between ${header.bg} ${header.text}`}>
              <div className="flex items-center gap-2">
                {isRunning && <div className="w-2 h-2 rounded-full bg-white/80" />}
                <span className="font-bold text-sm tracking-wide">{m.machineName}</span>
              </div>
              <div className={`bg-white px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${header.badgeText}`}>
                {m.status}
              </div>
            </div>

            <div className="p-5 flex-1 flex flex-col">
              {m.status === 'RUNNING' && <RunningStateInfo m={m} />}
              {m.status === 'IDLE' && <IdleStateInfo m={m} />}
              {m.status === 'STOPPAGE' && <StoppageStateInfo m={m} isDefect={false} />}
              {m.status === 'BREAKDOWN' && <StoppageStateInfo m={m} isDefect={true} />}
              {m.status === 'MAINTENANCE' && <IdleStateInfo m={m} />}
            </div>

            <div className="px-5 py-3 border-t border-border/50 flex justify-between items-center">
              <span className="text-[10px] font-bold text-muted-foreground uppercase">{m.machineCode}</span>
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
