import type { SixHiOrderDetail, SixHiRollingData, SixHiSkinPassData } from '@m1/shared-validation';
import { PPCInfoCards } from './PPCInfoCards';
import { FourHiRollingForm } from './FourHiRollingForm';
import { SharedSkinPassForm } from './SharedSkinPassForm';
import { useLiveTimer } from '../../hooks/useLiveTimer';

interface SixHiOrderWorkspaceProps {
  order: SixHiOrderDetail;
  workspaceOpen: boolean;
  workspaceBatch: string | null;
  busy?: boolean;
  compact?: boolean;
  combinedOrderCount?: number;
  combinedTargetMt?: number;
  combinedActualMt?: number;
  readOnly?: boolean;
  /** Hide PPC metadata when combined — details live in the slide panel */
  hidePpcDetail?: boolean;
  onSaveRolling: (data: SixHiRollingData) => Promise<void>;
  onSaveSkinPass: (data: SixHiSkinPassData) => Promise<void>;
}

export function SixHiOrderWorkspace({
  order,
  busy,
  compact,
  combinedOrderCount,
  combinedTargetMt,
  combinedActualMt,
  readOnly,
  hidePpcDetail,
  onSaveRolling,
  onSaveSkinPass,
}: SixHiOrderWorkspaceProps) {
  const isRolling = order.subProcess === 'ROLLING';

  const isRunning = order.status === 'IN_PROGRESS' && !!order.prodStartAt && !order.activeStoppage;
  const isStoppageActive = !!order.activeStoppage;

  const { formatted: runTime } = useLiveTimer(order.prodStartAt, isRunning);
  const { formatted: stopTime } = useLiveTimer(order.activeStoppage?.startAt, isStoppageActive);

  return (
    <div className={`flex flex-col ${compact ? 'gap-2' : 'gap-4 min-h-0'}`}>

      {(isRunning || isStoppageActive) && (
        <div className={`flex items-center justify-between rounded-xl border shadow-sm transition-colors shrink-0 ${
          compact ? 'px-4 py-2' : 'px-6 py-4'
        } ${
          isStoppageActive
            ? 'bg-destructive text-white border-destructive'
            : 'bg-success text-white border-success'
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide opacity-80 mb-0.5">
                {isStoppageActive ? 'Stoppage Active' : 'Production Active'}
              </div>
              <div className={`font-semibold truncate ${compact ? 'text-sm' : 'text-base'}`}>
                {isStoppageActive
                  ? `${order.activeStoppage?.categoryLabel ?? 'Stopped'} · ${order.activeStoppage?.remarks ?? 'No remarks'}`
                  : `Running since ${new Date(order.prodStartAt!).toLocaleTimeString()}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`font-mono font-bold tracking-tight ${compact ? 'text-2xl' : 'text-3xl'}`}>
              {isStoppageActive ? stopTime : runTime}
            </span>
          </div>
        </div>
      )}

      {!hidePpcDetail && (
        <PPCInfoCards
          data={order}
          compact={compact}
          combinedOrderCount={combinedOrderCount}
          combinedTargetMt={combinedTargetMt}
        />
      )}

      <div className={`bg-card border border-border rounded-xl shadow-sm ${compact ? '' : 'flex-1 min-h-0 flex flex-col overflow-hidden'}`}>
        {isRolling ? (
          <FourHiRollingForm
            order={order}
            busy={busy}
            combinedOrderCount={combinedOrderCount}
            combinedTargetMt={combinedTargetMt}
            combinedActualMt={combinedActualMt}
            onSave={onSaveRolling}
            compact={compact}
            readOnly={readOnly}
          />
        ) : (
          <SharedSkinPassForm
            order={order}
            busy={busy}
            combinedOrderCount={combinedOrderCount}
            combinedTargetMt={combinedTargetMt}
            combinedActualMt={combinedActualMt}
            onSave={onSaveSkinPass}
            compact={compact}
            readOnly={readOnly}
          />
        )}
      </div>
    </div>
  );
}
