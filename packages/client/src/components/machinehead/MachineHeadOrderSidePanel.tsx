import { useEffect, useState } from 'react';
import type { LiveOrderRow, SixHiOrderDetail } from '@m1/shared-validation';
import { Eye, Trash2 } from 'lucide-react';
import { SixHiStatusPill } from '../sixHi/SixHiStatusPill';
import { ZButton } from '../primitives/ZButton';
import { apiClient } from '../../lib/apiClient';
import { OrderProductionHistory } from '../sixHi/OrderProductionHistory';
import { OrderIdentityDisplay } from '../orders/OrderIdentityDisplay';
import { OrderRejectionSection } from '../orders/OrderRejectionSection';

interface MachineHeadOrderSidePanelProps {
  order: LiveOrderRow | null;
  onViewDetails: () => void;
  onDelete?: () => void;
  deleteBusy?: boolean;
}

function isDeletable(detail: SixHiOrderDetail | null, row: LiveOrderRow | null): boolean {
  const status = detail?.status ?? row?.status;
  const allowed = ['PENDING', 'PREPARING', 'IN_PROGRESS', 'STOPPAGE', 'COMPLETED', 'REJECTED'];
  return allowed.includes(status ?? '');
}

export function MachineHeadOrderSidePanel({
  order,
  onViewDetails,
  onDelete,
  deleteBusy,
}: MachineHeadOrderSidePanelProps) {
  const [detail, setDetail] = useState<SixHiOrderDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!order) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void apiClient
      .get<SixHiOrderDetail>(`/6hi/orders/${encodeURIComponent(order.batchNumber)}`)
      .then((loaded) => {
        if (!cancelled) setDetail(loaded);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [order?.batchNumber]);

  if (!order) {
    return (
      <div className="bg-white border border-border rounded-2xl p-5 h-full min-h-[200px] flex items-center justify-center text-muted-foreground text-sm text-center">
        Select an order to view details
      </div>
    );
  }

  const terminal = order.status === 'COMPLETED' || order.status === 'REJECTED';
  const canDelete = isDeletable(detail, order);

  return (
    <div className="bg-white border border-border rounded-2xl h-full min-h-[280px] flex flex-col shadow-sm overflow-hidden">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/60">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Order Details</p>
            <div className="mt-1">
              <OrderIdentityDisplay order={order} size="lg" />
            </div>
          </div>
          <SixHiStatusPill status={order.status} />
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 px-4 py-3 flex-1 min-h-0 overflow-y-auto content-start text-sm">
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Customer</dt>
          <dd className="font-semibold mt-0.5">{order.customer}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Grade</dt>
          <dd className="font-mono font-semibold mt-0.5">{order.grade}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Machine</dt>
          <dd className="font-semibold mt-0.5">{order.machineCode}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Process</dt>
          <dd className="font-semibold mt-0.5">{order.subProcess === 'SKIN_PASS' ? 'Skin Pass' : order.currentProcess}</dd>
        </div>
        <div>
          <dt className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Weight</dt>
          <dd className="font-mono font-semibold mt-0.5">{order.weightMt} MT</dd>
        </div>
        {order.operatorName && (
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Operator</dt>
            <dd className="font-semibold mt-0.5">{order.operatorName}</dd>
          </div>
        )}
        {loading && (
          <p className="col-span-2 text-xs text-muted-foreground">Loading production data…</p>
        )}
        {terminal && detail && (
          <div className="col-span-2 space-y-3">
            {detail.rejection && <OrderRejectionSection rejection={detail.rejection} />}
            <OrderProductionHistory order={detail} />
          </div>
        )}
      </dl>

      <div className="shrink-0 p-4 border-t border-border space-y-2">
        <ZButton variant="primary" fullWidth onClick={onViewDetails} className="gap-2 min-h-12">
          <Eye className="w-4 h-4" />
          {terminal ? 'View Full History' : 'View Full Details'}
        </ZButton>
        {canDelete && onDelete && (
          <ZButton
            variant="outline"
            fullWidth
            onClick={onDelete}
            disabled={deleteBusy}
            className="gap-2 min-h-11 text-destructive border-destructive/30 hover:bg-destructive/5"
          >
            <Trash2 className="w-4 h-4" />
            Delete Order
          </ZButton>
        )}
      </div>
    </div>
  );
}
