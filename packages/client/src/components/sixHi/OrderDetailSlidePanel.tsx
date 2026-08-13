import { X } from 'lucide-react';
import type { SixHiOrderDetail } from '@m1/shared-validation';
import { formatOrderStatusLabel } from '../../lib/orderLabels';
import {
  displayMotherCoilId,
  finishOf,
  thicknessDisplayForProcess,
} from '../../lib/sixHiOrderIdentity';
import { SixHiStatusPill } from './SixHiStatusPill';
import { OrderProductionHistory } from './OrderProductionHistory';

interface OrderDetailSlidePanelProps {
  order: SixHiOrderDetail | null;
  loading?: boolean;
  onClose: () => void;
}

export function OrderDetailSlidePanel({ order, loading, onClose }: OrderDetailSlidePanelProps) {
  if (!order && !loading) return null;

  const thickness = order ? thicknessDisplayForProcess(order) : null;

  return (
    <aside className="w-full xl:w-80 shrink-0 border-l border-border bg-white flex flex-col min-h-0 shadow-lg">
      <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/20">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Order Details</p>
          {order && (
            <p className="font-mono text-sm font-bold truncate mt-0.5">{displayMotherCoilId(order)}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-secondary shrink-0"
          aria-label="Close order details"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {loading && <p className="text-sm text-muted-foreground">Loading order…</p>}
        {order && (
          <>
            <div className="flex items-center gap-2 flex-wrap">
              <SixHiStatusPill status={order.status} />
              <span className="text-xs text-muted-foreground">{formatOrderStatusLabel(order.status)}</span>
            </div>

            <dl className="grid grid-cols-1 gap-2.5 text-sm">
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Batch</dt>
                <dd className="font-mono font-semibold">{order.batchNumber}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Coil</dt>
                <dd className="font-mono font-semibold">{displayMotherCoilId(order)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Customer</dt>
                <dd className="font-semibold">{order.customer}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Grade</dt>
                <dd className="font-mono font-semibold">{order.grade}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Width</dt>
                <dd className="font-mono font-semibold">{order.widthMm} mm</dd>
              </div>
              {thickness && (
                <>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{thickness.preLabel}</dt>
                    <dd className="font-mono font-semibold">{thickness.preValue} mm</dd>
                  </div>
                  {thickness.targetLabel && thickness.targetValue != null && (
                    <div>
                      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{thickness.targetLabel}</dt>
                      <dd className="font-mono font-semibold">{thickness.targetValue} mm</dd>
                    </div>
                  )}
                </>
              )}
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Finish</dt>
                <dd className="font-semibold">{finishOf(order)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Target Weight</dt>
                <dd className="font-mono font-semibold">{order.ppcWeightMt} MT</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Machine</dt>
                <dd className="font-semibold">{order.machineCode ?? '—'}</dd>
              </div>
            </dl>

            {(order.status === 'COMPLETED' || order.status === 'REJECTED') && (
              <OrderProductionHistory order={order} />
            )}
          </>
        )}
      </div>
    </aside>
  );
}
