import React from 'react';
import { StatusBadge } from '../ui/StatusBadge';
import type { Tone } from '../../lib/tones';

interface ShiftLogHeaderProps {
  date: string;
  shiftCode: string;
  processId: string;
  millType?: string | null;
  targetMt: number;
  lineIncharge: string;
  shiftManager: string;
  state: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REOPENED';
  compact?: boolean;
}

const STATE_TONE: Record<string, Tone> = {
  DRAFT: 'warning',
  SUBMITTED: 'info',
  APPROVED: 'success',
  REOPENED: 'destructive',
};

export function ShiftLogHeader({
  date, shiftCode, processId, millType, targetMt, lineIncharge, shiftManager, state, compact,
}: ShiftLogHeaderProps) {
  if (compact) {
    return (
      <div className="shrink-0 flex items-center gap-4 px-4 py-2 border-b border-border bg-card/60 text-xs">
        <span className="font-mono font-semibold text-accent">{processId}</span>
        <span className="text-muted-foreground">{date} · Shift {shiftCode}</span>
        <span className="text-muted-foreground hidden sm:inline">Target {targetMt} MT</span>
        <span className="text-muted-foreground hidden md:inline truncate">{lineIncharge}</span>
        <div className="ml-auto">
          <StatusBadge tone={STATE_TONE[state] || 'info'} label={state} />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider font-medium text-muted-foreground">
          Shift Context
        </span>
        <StatusBadge tone={STATE_TONE[state] || 'info'} label={state} />
      </div>
      <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Date</div>
          <div className="font-mono text-xs mt-0.5">{date}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Shift</div>
          <div className="font-mono text-xs mt-0.5">{shiftCode}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Process</div>
          <div className="font-mono text-xs mt-0.5">{processId}{millType ? ` (${millType})` : ''}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Target</div>
          <div className="font-mono text-xs mt-0.5">{targetMt} MT</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Line In-Charge</div>
          <div className="text-xs mt-0.5">{lineIncharge}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Shift Manager</div>
          <div className="text-xs mt-0.5">{shiftManager}</div>
        </div>
      </div>
    </div>
  );
}
