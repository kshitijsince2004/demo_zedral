import type { SixHiOrderDetail } from '@m1/shared-validation';
import { SixHiProductionActionRail } from './SixHiProductionActionRail';
import type { CombinedProductionRun } from '../../store/sixHiStore';

interface SixHiGlobalProductionPanelProps {
  order: SixHiOrderDetail;
  workspaceOpen: boolean;
  workspaceBatch: string | null;
  busy?: boolean;
  combinedRun?: CombinedProductionRun | null;
  combinedSelectedCount?: number;
  matchingCount?: number;
  startDisabled?: boolean;
  onStart: () => void;
  onEnd: () => void;
  onRemark: () => void;
  onReject: () => void;
  onStoppage: () => void;
  onViewOrder: () => void;
  onCloseWorkspace?: () => void;
  embedded?: boolean;
}

/** Vertical right-hand production controls — embedded in console or fixed when console closed. */
export function SixHiGlobalProductionPanel({
  order,
  workspaceOpen,
  workspaceBatch,
  busy,
  onStart,
  onEnd,
  onRemark,
  onReject,
  onStoppage,
  combinedRun,
  combinedSelectedCount,
  matchingCount,
  startDisabled,
  embedded,
}: SixHiGlobalProductionPanelProps) {
  const rail = (
    <SixHiProductionActionRail
      order={order}
      workspaceOpen={workspaceOpen}
      workspaceBatch={workspaceBatch}
      busy={busy}
      combinedRun={combinedRun}
      combinedSelectedCount={combinedSelectedCount}
      matchingCount={matchingCount}
      startDisabled={startDisabled}
      onStart={onStart}
      onEnd={onEnd}
      onRemark={onRemark}
      onReject={onReject}
      onStoppage={onStoppage}
    />
  );

  if (embedded) return rail;

  return (
    <div className="fixed right-0 top-[52px] bottom-0 z-[100] shadow-[-4px_0_24px_rgba(22,51,40,0.08)]">
      {rail}
    </div>
  );
}
