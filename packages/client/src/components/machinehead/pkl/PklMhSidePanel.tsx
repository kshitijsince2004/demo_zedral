import { useState } from 'react';
import { Eye, Info, RotateCcw, Trash2 } from 'lucide-react';
import { MhOrderActionConfirmModal } from '../MhOrderActionConfirmModal';
import { OrderIdentityDisplay } from '../../orders/OrderIdentityDisplay';
import { ZBadge } from '../../primitives/ZBadge';
import { ZButton } from '../../primitives/ZButton';
import { formatOrderStatusLabel } from '../../../lib/orderLabels';
import type { Tone } from '../../../lib/tones';
import type { ProcessQueueCard } from '../../../store/processStore';

export type PklEntryShape = {
  coilNo?: string;
  gradeCode?: string;
  weightMt?: number;
  motherCoilNo?: string;
  slitId?: string;
  customerName?: string;
  prefill?: Record<string, unknown>;
  pklCapture?: Record<string, unknown> | null;
};

export type PklOrderShape = {
  orderId?: string;
  coilNo?: string;
  status?: string;
  gradeCode?: string;
  widthMm?: number;
  thicknessMm?: number;
  weightMt?: number;
  customerName?: string;
  prodStartAt?: string;
  prodEndAt?: string;
  prodDurationMin?: number;
  shiftLogId?: string;
  shiftCode?: string;
  holdReason?: string;
  holdRemarks?: string;
  motherCoilNo?: string;
  slitId?: string;
  stoppages?: Array<{
    stoppageId?: string;
    categoryCode?: string;
    breakdownCode?: string;
    startAt?: string;
    endAt?: string;
    durationMin?: number;
    remarks?: string;
  }>;
};

export type PklCoilDetail = {
  order: PklOrderShape | null;
  entry: PklEntryShape | null;
};

function statusTone(status: string): Tone {
  const u = status.toUpperCase();
  if (u === 'PENDING' || u === 'HOLD') return 'accent';
  if (u === 'IN_PROGRESS') return 'success';
  if (u === 'STOPPAGE') return 'warning';
  if (u === 'PREPARING') return 'info';
  if (u === 'REJECTED') return 'destructive';
  return 'muted';
}

function identity(card: ProcessQueueCard) {
  return {
    batchNumber: card.batchNumber ?? card.coilNo,
    coilNo: card.coilNo,
    motherCoilNo: card.motherCoilNo,
    slitId: card.slitId,
    displayCoilNo: card.displayCoilNo,
  };
}

/** PKL MH order side panel — summary + drawer CTAs. */
export function PklMhSidePanel({
  card,
  detail,
  detailLoading,
  busy,
  onShowPklDetails,
  onShowCompleteInfo,
  onReinstatePreparing,
  onDelete,
}: {
  card: ProcessQueueCard | null;
  detail: PklCoilDetail | null;
  detailLoading: boolean;
  busy: boolean;
  onShowPklDetails: () => void;
  onShowCompleteInfo: () => void;
  onReinstatePreparing?: () => void;
  onDelete?: () => void;
}) {
  const [confirmAction, setConfirmAction] = useState<'reinstate' | 'delete' | null>(null);

  if (!card) {
    return (
      <div className="bg-white border border-border rounded-2xl p-5 min-h-[120px] flex items-center justify-center text-muted-foreground text-sm text-center">
        Select an order to view details
      </div>
    );
  }

  const order = detail?.order ?? null;
  const holdReason = order?.holdReason || order?.holdRemarks;
  const coilLabel = card.displayCoilNo ?? card.coilNo;

  return (
    <div className="bg-white border border-border rounded-2xl flex flex-col shadow-sm overflow-hidden max-h-[min(720px,calc(100vh-12rem))]">
      <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border/60">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Order Details</p>
            <div className="mt-1 flex items-start justify-between gap-2">
              <OrderIdentityDisplay order={identity(card)} size="lg" />
              <ZBadge tone={statusTone(card.status)} label={formatOrderStatusLabel(card.status)} />
            </div>
          </div>
          <button
            type="button"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Complete order details"
            onClick={onShowCompleteInfo}
          >
            <Info className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {detailLoading && (
          <p className="text-sm text-muted-foreground py-2">Loading order details…</p>
        )}
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-sm">
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Customer</dt>
            <dd className="font-semibold mt-0.5">{card.customerName || order?.customerName || '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Grade</dt>
            <dd className="font-mono font-semibold mt-0.5">{card.gradeCode || order?.gradeCode || '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Weight</dt>
            <dd className="font-mono font-semibold mt-0.5">{Number(card.weightMt ?? order?.weightMt ?? 0).toFixed(2)} MT</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Process</dt>
            <dd className="font-semibold mt-0.5">Pickling</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Route</dt>
            <dd className="font-mono font-semibold mt-0.5 break-all">{card.routeRaw || '—'}</dd>
          </div>
          {holdReason && (
            <div className="col-span-2">
              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Hold reason</dt>
              <dd className="mt-0.5 text-sm">{holdReason}</dd>
            </div>
          )}
        </dl>
      </div>

      <div className="shrink-0 p-4 border-t border-border space-y-2">
        <ZButton variant="primary" fullWidth onClick={onShowPklDetails} className="gap-2 min-h-12">
          <Eye className="w-4 h-4" />
          View Full Details
        </ZButton>
        {onReinstatePreparing && (
          <ZButton
            variant="secondary"
            fullWidth
            onClick={() => setConfirmAction('reinstate')}
            disabled={busy}
            className="gap-2 min-h-11"
          >
            <RotateCcw className="w-4 h-4" />
            Move back to Preparing
          </ZButton>
        )}
        {onDelete && (
          <ZButton
            variant="secondary"
            fullWidth
            onClick={() => setConfirmAction('delete')}
            disabled={busy}
            className="gap-2 min-h-11 text-destructive border-destructive/30 hover:bg-destructive/5"
          >
            <Trash2 className="w-4 h-4" />
            Delete Order
          </ZButton>
        )}
      </div>

      <MhOrderActionConfirmModal
        open={confirmAction === 'reinstate'}
        title="Move back to Preparing?"
        message={`Move ${coilLabel} back to Preparing? This returns the order to the active queue.`}
        confirmLabel="Move to Preparing"
        busy={busy}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          onReinstatePreparing?.();
          setConfirmAction(null);
        }}
      />
      <MhOrderActionConfirmModal
        open={confirmAction === 'delete'}
        title="Delete order?"
        message={`Delete order ${coilLabel}? The PPC plan stays. This cannot be undone.`}
        confirmLabel="Delete Order"
        danger
        busy={busy}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => {
          onDelete?.();
          setConfirmAction(null);
        }}
      />
    </div>
  );
}
