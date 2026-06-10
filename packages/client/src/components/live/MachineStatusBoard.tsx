import React from 'react';
import type { MachineStatusCard, MachineLiveStatus } from '@m1/shared-validation';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { AlertTriangle, ShieldAlert } from 'lucide-react';

function getHeaderConfig(status: MachineLiveStatus) {
  switch (status) {
    case 'RUNNING': return { bg: 'bg-[#10B981]', text: 'text-white', badgeText: 'text-[#10B981]' };
    case 'IDLE': return { bg: 'bg-[#8CA0B9]', text: 'text-white', badgeText: 'text-slate-600' };
    case 'BREAKDOWN': return { bg: 'bg-destructive', text: 'text-white', badgeText: 'text-destructive' };
    case 'STOPPAGE': return { bg: 'bg-warning', text: 'text-white', badgeText: 'text-warning' };
    case 'MAINTENANCE': return { bg: 'bg-info', text: 'text-white', badgeText: 'text-info' };
    default: return { bg: 'bg-[#8CA0B9]', text: 'text-white', badgeText: 'text-slate-600' };
  }
}

function RunningStateInfo({ m }: { m: MachineStatusCard }) {
  // Mock start time if missing for demo purposes
  const startTime = m.runtimeMin ? new Date(Date.now() - m.runtimeMin * 60000).toISOString() : new Date().toISOString();
  const { formatted } = useLiveTimer(startTime, true);

  return (
    <>
      <div className="flex justify-between items-baseline mb-4">
        <span className="text-3xl font-mono font-bold tracking-tight text-[#10B981]">{formatted}</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#10B981]">Runtime</span>
      </div>
      
      <div className="bg-[#ECFDF5] rounded-xl p-3 mb-4">
        <div className="text-[9px] font-bold uppercase tracking-wider text-[#10B981] mb-1">Current Order</div>
        <div className="font-bold text-sm text-gray-900">{m.currentOrder || '—'}</div>
      </div>
      
      <div className="grid grid-cols-2 gap-y-3">
        <div>
          <div className="text-[11px] text-slate-500 mb-0.5">Operator</div>
          <div className="text-xs font-bold text-gray-900">{m.currentOperator || '—'}</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 mb-0.5">Shift</div>
          <div className="text-xs font-bold text-gray-900">B</div>
        </div>
        <div className="col-span-2">
          <div className="text-[11px] text-slate-500 mb-0.5">Produced</div>
          <div className="text-xs font-bold text-[#10B981]">14.5 MT</div>
        </div>
      </div>
    </>
  );
}

function IdleStateInfo({ m }: { m: MachineStatusCard }) {
  return (
    <>
      <div className="flex justify-between items-baseline mb-4">
        <span className="text-3xl font-mono font-bold tracking-tight text-slate-600">—</span>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Idle For</span>
      </div>
      
      <div className="grid grid-cols-1 gap-y-4">
        <div>
          <div className="text-[11px] text-slate-500 mb-0.5">Last Order</div>
          <div className="text-xs font-medium text-gray-900">—</div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 mb-0.5">Last Operator</div>
          <div className="text-xs font-medium text-gray-900">—</div>
        </div>
      </div>
    </>
  );
}

function StoppageStateInfo({ m, isDefect = false }: { m: MachineStatusCard, isDefect?: boolean }) {
  const startTime = new Date(Date.now() - 2118000).toISOString(); // ~35m
  const { formatted } = useLiveTimer(startTime, true);
  
  const colorClass = isDefect ? 'text-destructive' : 'text-warning';

  return (
    <>
      <div className="flex justify-between items-baseline mb-4">
        <span className={`text-3xl font-mono font-bold tracking-tight ${colorClass}`}>{formatted}</span>
        <span className={`text-[10px] font-bold uppercase tracking-wider ${colorClass}`}>{isDefect ? 'Defect' : 'Stoppage'}</span>
      </div>
      
      <div className="grid grid-cols-1 gap-y-4">
        <div>
          <div className="text-[11px] text-slate-500 mb-0.5">Reason</div>
          <div className="text-sm font-semibold text-gray-900 flex items-center gap-1.5">
            {isDefect ? <ShieldAlert className={`w-4 h-4 ${colorClass}`} /> : <AlertTriangle className={`w-4 h-4 ${colorClass}`} />}
            {isDefect ? 'Roll Mark' : 'Material Jam'}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 mb-0.5">Since</div>
          <div className="text-xs font-medium text-gray-900">{new Date(startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
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
      <p className="text-sm text-muted-foreground py-8 text-center border border-dashed border-border rounded-2xl">
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
            className="border-x border-b border-t-0 border-border rounded-2xl bg-white shadow-sm flex flex-col text-left transition-all hover:shadow-md hover:border-primary/40 overflow-hidden relative min-h-[320px]"
          >
            {/* Colored Header */}
            <div className={`px-4 py-3 flex items-center justify-between ${header.bg} ${header.text}`}>
              <div className="flex items-center gap-2">
                {isRunning && <div className="w-2 h-2 rounded-full bg-white/80" />}
                <span className="font-bold text-sm tracking-wide">{m.machineName}</span>
              </div>
              <div className={`bg-white px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest ${header.badgeText}`}>
                {m.status}
              </div>
            </div>

            {/* Dynamic Content Area */}
            <div className="p-5 flex-1 flex flex-col">
              {m.status === 'RUNNING' && <RunningStateInfo m={m} />}
              {m.status === 'IDLE' && <IdleStateInfo m={m} />}
              {m.status === 'STOPPAGE' && <StoppageStateInfo m={m} isDefect={false} />}
              {m.status === 'BREAKDOWN' && <StoppageStateInfo m={m} isDefect={true} />}
              {m.status === 'MAINTENANCE' && <IdleStateInfo m={m} />}
            </div>
            
            {/* Footer */}
            <div className="px-5 py-3 border-t border-border/50 flex justify-between items-center">
              <span className="text-[10px] font-bold text-slate-400 uppercase">{m.machineCode}</span>
              <span className="text-[10px] text-slate-400">
                Updated {isRunning ? '08:05 PM' : '—'}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
