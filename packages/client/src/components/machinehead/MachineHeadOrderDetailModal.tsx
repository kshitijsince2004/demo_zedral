import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { SixHiOrderDetail } from '@m1/shared-validation';
import { apiClient } from '../../lib/apiClient';
import { SixHiOrderWorkspace } from '../sixHi/SixHiOrderWorkspace';
import { SixHiStatusPill } from '../sixHi/SixHiStatusPill';
import { OrderProductionHistory } from '../sixHi/OrderProductionHistory';
import { OrderIdentityDisplay } from '../orders/OrderIdentityDisplay';
import { overlayClass } from '../../lib/nativeOverlay';

interface MachineHeadOrderDetailModalProps {
  batchNumber: string | null;
  open: boolean;
  onClose: () => void;
}

export function MachineHeadOrderDetailModal({
  batchNumber,
  open,
  onClose,
}: MachineHeadOrderDetailModalProps) {
  const [order, setOrder] = useState<SixHiOrderDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !batchNumber) {
      setOrder(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void apiClient
      .get<SixHiOrderDetail>(`/6hi/orders/${encodeURIComponent(batchNumber)}`)
      .then((loaded) => {
        if (!cancelled) {
          setOrder(loaded);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setOrder(null);
          setError((err as Error)?.message ?? 'Failed to load order');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, batchNumber]);

  if (!open || !batchNumber) return null;

  const terminal = order?.status === 'COMPLETED' || order?.status === 'REJECTED';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-8">
      <div className={overlayClass('absolute inset-0 bg-black/40', 'backdrop-blur-sm')} onClick={onClose} aria-hidden />
      <div
        className="relative bg-background border border-border shadow-2xl rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden"
        role="dialog"
        aria-label="Order details"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0 bg-muted/20">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {order ? (
                <OrderIdentityDisplay order={order} size="lg" showSubtitle={false} />
              ) : (
                <h2 className="font-mono text-lg font-bold truncate">{batchNumber}</h2>
              )}
              {order && <SixHiStatusPill status={order.status} />}
            </div>
            {order && (
              <p className="text-xs text-muted-foreground mt-1">Batch {order.batchNumber}</p>
            )}
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mt-1">
              Read-only · Machine Head view
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-muted/80 transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-5 bg-secondary/20">
          {loading && (
            <div className="py-16 text-center text-sm text-muted-foreground">Loading order…</div>
          )}
          {error && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {order && (
            <div className="space-y-4">
              {terminal && (
                <div className="bg-white border border-border rounded-xl p-4">
                  <OrderProductionHistory order={order} />
                </div>
              )}
              <SixHiOrderWorkspace
                order={order}
                workspaceOpen
                workspaceBatch={batchNumber}
                readOnly
                compact
                onSaveRolling={async () => {}}
                onSaveSkinPass={async () => {}}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
