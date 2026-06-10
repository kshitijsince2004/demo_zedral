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
        <div className={`flex items-center justify-between px-6 py-4 rounded-xl border shadow-sm transition-colors ${
          isStoppageActive
            ? 'bg-destructive text-white border-destructive'
            : 'bg-success text-white border-success'
        }`}>
          <div className="flex items-center gap-3">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide opacity-80 mb-0.5">
                {isStoppageActive ? 'Stoppage Active' : 'Production Active'}
              </div>
              <div className="text-base font-semibold">
                {isStoppageActive
                  ? `${order.activeStoppage?.categoryLabel ?? 'Stopped'} · ${order.activeStoppage?.remarks ?? 'No remarks'}`
                  : `Running since ${new Date(order.prodStartAt!).toLocaleTimeString()}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
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
