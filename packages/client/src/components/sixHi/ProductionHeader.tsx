import type { SixHiOrderDetail } from '@m1/shared-validation';
import { ZBadge } from '../primitives/ZBadge';
import type { Tone } from '../../lib/tones';
import { formatOrderStatusLabel } from '../../lib/orderLabels';
import { displayMotherCoilId, thicknessDisplayForProcess } from '../../lib/sixHiOrderIdentity';

const statusTone = (status: string): Tone => {
  if (status === 'PENDING') return 'info';
  if (status === 'IN_PROGRESS') return 'warning';
  if (status === 'STOPPAGE') return 'destructive';
  return 'success';
};

interface ProductionHeaderProps {
  order: SixHiOrderDetail;
  timerLabel?: string;
}

export function ProductionHeader({ order, timerLabel }: ProductionHeaderProps) {
  const thickness = thicknessDisplayForProcess(order);

  return (
    <div className="border border-border rounded-sm bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-mono text-xl font-semibold">{displayMotherCoilId(order)}</h2>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Batch {order.batchNumber}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ZBadge tone={statusTone(order.status)} label={formatOrderStatusLabel(order.status)} />
          {timerLabel && (
            <span className="font-mono text-sm text-muted-foreground">{timerLabel}</span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Customer</span>
          <p>{order.customer}</p>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Grade</span>
          <p>{order.grade}</p>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">PPC Weight</span>
          <p className="font-mono">{order.ppcWeightMt} MT</p>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{thickness.preLabel}</span>
          <p className="font-mono">{thickness.preValue} mm</p>
        </div>
        {thickness.targetLabel && thickness.targetValue != null && (
          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{thickness.targetLabel}</span>
            <p className="font-mono">{thickness.targetValue} mm</p>
          </div>
        )}
      </div>
    </div>
  );
}
