import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { RejectedOrderRow } from '@m1/shared-validation';
import { ORDER_HOLD_STATUS_LABEL } from '../../lib/orderLabels';
import { liveService } from '../../lib/liveService';
import { formatPlantDateTime } from '../../lib/dateFormat';
import { OrderIdentityDisplay } from '../orders/OrderIdentityDisplay';
import { ZButton } from '../primitives/ZButton';

interface RejectedOrdersDrawerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (batchNumber: string) => void;
  date?: string;
  shiftCode?: string;
}

export function RejectedOrdersDrawer({
  open,
  onClose,
  onSelect,
  date,
  shiftCode,
}: RejectedOrdersDrawerProps) {
  const [orders, setOrders] = useState<RejectedOrderRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await liveService.getRejectedOrders({
        date,
        shiftCode,
        limit: 100,
      });
      setOrders(res.orders);
    } catch (err: unknown) {
      setError((err as Error)?.message ?? `Failed to load ${ORDER_HOLD_STATUS_LABEL.toLowerCase()} orders`);
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [date, shiftCode]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <aside className="relative w-full max-w-lg bg-background border-l border-border shadow-2xl flex flex-col h-full">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="font-bold text-lg">{ORDER_HOLD_STATUS_LABEL}</h2>
            <p className="text-xs text-muted-foreground">Click an order to view full details</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-muted" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && <p className="p-5 text-sm text-muted-foreground">Loading…</p>}
          {error && <p className="p-5 text-sm text-destructive">{error}</p>}
          {!loading && !error && orders.length === 0 && (
            <p className="p-5 text-sm text-muted-foreground">No orders on hold for this scope.</p>
          )}
          <ul className="divide-y divide-border">
            {orders.map((order) => (
              <li key={order.batchNumber}>
                <button
                  type="button"
                  className="w-full text-left px-5 py-4 hover:bg-secondary transition-colors"
                  onClick={() => onSelect(order.batchNumber)}
                >
                  <OrderIdentityDisplay
                    order={{ batchNumber: order.batchNumber, coilNo: order.coilNo }}
                    size="sm"
                  />
                  <p className="text-xs text-muted-foreground mt-2 truncate">{order.reason}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {order.machineCode} · Held by {order.rejectedBy} · {formatPlantDateTime(order.rejectionTime)}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="p-4 border-t border-border">
          <ZButton variant="secondary" fullWidth onClick={() => void load()} disabled={loading}>
            Refresh
          </ZButton>
        </div>
      </aside>
    </div>
  );
}
