import type { SixHiOrderDetail, SixHiRollingData, SixHiSkinPassData } from '@m1/shared-validation';
import { PPCInfoCards } from './PPCInfoCards';
import { RollingWorkspace } from './RollingWorkspace';
import { SkinPassWorkspace } from './SkinPassWorkspace';

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

  if (compact) {
    return (
      <div className="flex flex-col gap-2 h-full min-h-0 overflow-hidden">
        <PPCInfoCards data={order} compact />
        <div className="flex-1 min-h-0 overflow-hidden">
          {isRolling ? (
            <RollingWorkspace order={order} busy={busy} onSave={onSaveRolling} compact />
          ) : (
            <SkinPassWorkspace order={order} busy={busy} onSave={onSaveSkinPass} compact />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <PPCInfoCards data={order} />
      {isRolling ? (
        <RollingWorkspace order={order} busy={busy} onSave={onSaveRolling} />
      ) : (
        <SkinPassWorkspace order={order} busy={busy} onSave={onSaveSkinPass} />
      )}
    </div>
  );
}
