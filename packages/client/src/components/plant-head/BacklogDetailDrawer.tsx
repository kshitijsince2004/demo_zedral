import { useEffect, useState } from 'react';
import type { LiveOrderDetail } from '@m1/shared-validation';
import { ZDrawer } from '../primitives/ZDrawer';
import { ZButton } from '../primitives/ZButton';
import { ZBadge } from '../primitives/ZBadge';
import { reportingService, type PlantHeadBacklogOrder } from '../../lib/reportingService';
import { liveService } from '../../lib/liveService';
import { OrderDetailModal } from '../live/OrderDetailModal';

interface BacklogDetailDrawerProps {
  open: boolean;
  onClose: () => void;
}

function formatStatus(status: string) {
  return status.replace(/_/g, ' ');
}

function statusTone(status: string) {
  if (status === 'IN_PROGRESS' || status === 'PREPARING') return 'info' as const;
  if (status === 'STOPPAGE') return 'warning' as const;
  if (status === 'COMPLETED') return 'success' as const;
  return 'muted' as const;
}

export function BacklogDetailDrawer({ open, onClose }: BacklogDetailDrawerProps) {
  const [orders, setOrders] = useState<PlantHeadBacklogOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailOrder, setDetailOrder] = useState<LiveOrderDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(null);
    reportingService.getPlantHeadBacklog()
      .then((res) => {
        if (!active) return;
        setOrders(res.orders);
        setTotal(res.total);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Failed to load backlog orders');
        setOrders([]);
        setTotal(0);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [open]);

  const loadDetail = async (batchNumber: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setDetailOrder(null);
    try {
      const detail = await liveService.getOrderDetail(batchNumber);
      setDetailOrder(detail);
    } catch {
      setDetailOrder(null);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <>
      <ZDrawer
        open={open}
        onClose={onClose}
        title={`Backlog Orders (${total})`}
        size="large"
      >
        <div className="flex flex-col h-full overflow-hidden">
          {error && (
            <div className="p-4 bg-destructive/10 text-destructive text-sm border-b border-destructive/20">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Loading backlog orders…
            </div>
          ) : orders.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              No backlog orders.
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background border-b border-border">
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-semibold">Order</th>
                    <th className="px-4 py-3 font-semibold">Coil</th>
                    <th className="px-4 py-3 font-semibold">Planned</th>
                    <th className="px-4 py-3 font-semibold">Pending</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Machine</th>
                    <th className="px-4 py-3 font-semibold">Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr
                      key={order.batchId}
                      className="border-b border-border/60 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => loadDetail(order.batchNumber)}
                    >
                      <td className="px-4 py-3 font-mono font-medium">{order.batchNumber}</td>
                      <td className="px-4 py-3">
                        <div className="font-mono">
                          {order.slitId ? `${order.coilNo} ${order.slitId}` : order.coilNo}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div>{order.planDate}</div>
                        <div className="text-xs text-muted-foreground">Shift {order.shiftCode}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {order.daysPending === 0 ? 'Today' : `${order.daysPending}d`}
                      </td>
                      <td className="px-4 py-3">
                        <ZBadge tone={statusTone(order.status)} label={formatStatus(order.status)} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {order.machineCode
                          ? (order.machineName ? `${order.machineCode} · ${order.machineName}` : order.machineCode)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{order.stage ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="shrink-0 border-t border-border p-4 flex justify-end">
            <ZButton variant="ghost" onClick={onClose}>Close</ZButton>
          </div>
        </div>
      </ZDrawer>

      <OrderDetailModal
        open={detailOpen}
        order={detailOrder}
        loading={detailLoading}
        onClose={() => {
          setDetailOpen(false);
          setDetailOrder(null);
        }}
      />
    </>
  );
}
