import type { SixHiOrderDetail, SixHiRollingData, SixHiSkinPassData } from '@m1/shared-validation';
import { PPCInfoCards } from './PPCInfoCards';
import { FourHiRollingForm } from './FourHiRollingForm';
import { SharedSkinPassForm } from './SharedSkinPassForm';
import { ProductionStatusBanner } from './ProductionStatusBanner';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { millSupportsRolling } from '../../lib/millConfig';

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
  const { machineCode } = useWorkspaceBase();
  const isRolling = order.subProcess === 'ROLLING' && millSupportsRolling(machineCode);

  return (
    <div className={`flex flex-col ${compact ? 'gap-2' : 'gap-4 min-h-0'}`}>

      <ProductionStatusBanner order={order} compact={compact} />

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
