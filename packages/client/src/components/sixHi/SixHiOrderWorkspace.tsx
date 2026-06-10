import type { SixHiOrderDetail, SixHiRollingData, SixHiSkinPassData } from '@m1/shared-validation';
import { PPCInfoCards } from './PPCInfoCards';
import { FourHiRollingForm } from './FourHiRollingForm';
import { SharedSkinPassForm } from './SharedSkinPassForm';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { Activity, AlertTriangle, Clock } from 'lucide-react';

interface SixHiOrderWorkspaceProps {
  order: SixHiOrderDetail;
  workspaceOpen: boolean;
  workspaceBatch: string | null;
  busy?: boolean;
  compact?: boolean;
  onSaveRolling: (data: SixHiRollingData) => Promise<void>;
  onSaveSkinPass: (data: SixHiSkinPassData) => Promise<void>;
}

export function SixHiOrderWorkspace({
  order,
  busy,
  compact,
  onSaveRolling,
  onSaveSkinPass,
}: SixHiOrderWorkspaceProps) {
  const isRolling = order.subProcess === 'ROLLING';

  const isRunning = order.status === 'IN_PROGRESS' && !!order.prodStartAt && !order.activeStoppage;
  const isStoppageActive = !!order.activeStoppage;

  const { formatted: runTime } = useLiveTimer(order.prodStartAt, isRunning);
  const { formatted: stopTime } = useLiveTimer(order.activeStoppage?.startAt, isStoppageActive);

  return (
    <div className={`flex flex-col gap-4 ${compact ? 'h-full min-h-0 overflow-hidden' : 'min-h-0'}`}>

      {(isRunning || isStoppageActive) && (
        <div className={`flex items-center justify-between px-5 py-3 rounded-xl border shadow-sm transition-colors ${
          isStoppageActive
            ? 'bg-destructive/10 border-destructive/30 text-destructive'
            : 'bg-[#10B981]/10 border-[#10B981]/30 text-[#10B981]'
        }`}>
          <div className="flex items-center gap-3">
            {isStoppageActive ? <AlertTriangle className="w-5 h-5 animate-pulse" /> : <Activity className="w-5 h-5" />}
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest opacity-80">
                {isStoppageActive ? 'Stoppage Active' : 'Production Active'}
              </div>
              <div className="text-sm font-semibold opacity-90">
                {isStoppageActive
                  ? `${order.activeStoppage?.categoryLabel ?? 'Stopped'} · ${order.activeStoppage?.remarks ?? 'No remarks'}`
                  : `Running since ${new Date(order.prodStartAt!).toLocaleTimeString()}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 opacity-70" />
            <span className="font-mono text-3xl font-bold tracking-tight">
              {isStoppageActive ? stopTime : runTime}
            </span>
          </div>
        </div>
      )}

      <PPCInfoCards data={order} compact={compact} />

      <div className="overflow-auto hide-scrollbar bg-card border border-border rounded-xl shadow-sm p-4 flex-1 min-h-0">
        {isRolling ? (
          <FourHiRollingForm order={order} busy={busy} onSave={onSaveRolling} compact={compact} />
        ) : (
          <SharedSkinPassForm order={order} busy={busy} onSave={onSaveSkinPass} compact={compact} />
        )}
      </div>
    </div>
  );
}
