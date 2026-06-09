import type { SixHiOrderDetail } from '@m1/shared-validation';
import { ZBadge } from '../primitives/ZBadge';
import type { Tone } from '../../lib/tones';

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
  return (
    <div className="border border-border rounded-sm bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-mono text-lg font-semibold">{order.batchNumber}</h2>
        <div className="flex items-center gap-2">
          <ZBadge tone={statusTone(order.status)} label={order.status.replace('_', ' ')} />
          {timerLabel && (
            <span className="font-mono text-sm text-muted-foreground">{timerLabel}</span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Mother Coil</span>
          <p className="font-mono">{order.motherCoil}{order.slitId ? ` / ${order.slitId}` : ''}</p>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Customer</span>
          <p>{order.customer}</p>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Grade</span>
          <p>{order.grade}</p>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Width</span>
          <p className="font-mono">{order.widthMm} mm</p>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">PPC Thickness</span>
          <p className="font-mono">{order.ppcThkMm} mm</p>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">PPC Weight</span>
          <p className="font-mono">{order.ppcWeightMt} MT</p>
        </div>
      </div>
    </div>
  );
}
