import type { SixHiOrderDetail } from '@m1/shared-validation';
import { SixHiProductionActionRail } from './SixHiProductionActionRail';

interface SixHiGlobalProductionPanelProps {
  order: SixHiOrderDetail;
  workspaceOpen: boolean;
  workspaceBatch: string | null;
  busy?: boolean;
  onStart: () => void;
  onEnd: () => void;
  onStoppage: () => void;
  onRemark: () => void;
  onReject: () => void;
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
  onStoppage,
  onRemark,
  onReject,
  embedded,
}: SixHiGlobalProductionPanelProps) {
  const rail = (
    <SixHiProductionActionRail
      order={order}
      workspaceOpen={workspaceOpen}
      workspaceBatch={workspaceBatch}
      busy={busy}
      onStart={onStart}
      onEnd={onEnd}
      onStoppage={onStoppage}
      onRemark={onRemark}
      onReject={onReject}
    />
  );

  if (embedded) return rail;

  return (
    <div className="fixed right-0 top-[52px] bottom-0 z-[100] shadow-[-4px_0_24px_rgba(22,51,40,0.08)]">
      {rail}
    </div>
  );
}
