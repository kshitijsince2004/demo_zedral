import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { allocateCombinedWeight } from '@m1/shared-validation';
import { X } from 'lucide-react';
import { displayMotherCoilId } from '../../../lib/sixHiOrderIdentity';
import { manualRerollStatusToPill } from '../../../lib/manualRerollUi';
import { overlayClass } from '../../../lib/nativeOverlay';
import { SixHiStatusPill } from '../SixHiStatusPill';
import { PPCInfoCards } from '../PPCInfoCards';
import type { ManualRerollSession } from '../../../services/manualRerollService';
import {
  ManualRerollCaptureForm,
  type ManualRerollConsoleContext,
  type ManualRerollOrderSummary,
} from './ManualRerollCaptureForm';

interface ManualRerollWorkspaceModalProps {
  open: boolean;
  session: ManualRerollSession | null;
  machine: string;
  context?: ManualRerollConsoleContext | null;
  actionRail?: ReactNode;
  onClose: () => void;
  onSaved?: (session: ManualRerollSession) => void;
}

/** Map re-roll order → PPCInfoCards (SKIN_PASS so Pre-stage / Target matches rolling glance). */
function toPpcSource(order: ManualRerollOrderSummary, context?: ManualRerollConsoleContext | null) {
  return {
    batchNumber: order.batchNumber,
    motherCoil: order.coilNo ?? order.batchNumber,
    coilNo: order.coilNo,
    slitId: order.slitId ?? undefined,
    customer: order.customer ?? '—',
    grade: order.grade ?? '—',
    widthMm: order.widthMm ?? 0,
    inputThkMm: context?.inputThkMm ?? undefined,
    targetThkMm: context?.thkMm ?? order.thkMm ?? undefined,
    ppcWeightMt: order.weightMt ?? 0,
    subProcess: 'SKIN_PASS' as const,
    ppcRollFinish: order.rollFinish ?? undefined,
  };
}

function ManualRerollOrderDetailAside({
  order,
  context,
  onClose,
}: {
  order: ManualRerollOrderSummary;
  context?: ManualRerollConsoleContext | null;
  onClose: () => void;
}) {
  return (
    <aside className="w-full xl:w-[22rem] shrink-0 border-l border-border bg-secondary flex flex-col min-h-0 shadow-lg">
      <div className="shrink-0 flex items-center justify-end px-2 py-2 border-b border-border bg-muted/20">
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-secondary shrink-0"
          aria-label="Close order details"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2">
        <PPCInfoCards data={toPpcSource(order, context)} compact />
      </div>
    </aside>
  );
}

/** Rolling CombinedProductionOrdersPanel look — Target / Produced / Balance + order cards. */
function CombinedOrdersStrip({
  orders,
  selectedBatch,
  onSelect,
  producedMt,
  sessionStatus,
}: {
  orders: ManualRerollOrderSummary[];
  selectedBatch: string | null;
  onSelect: (batchNumber: string) => void;
  producedMt?: number | null;
  sessionStatus: string;
}) {
  const totalTargetMt = orders.reduce((sum, o) => sum + (o.weightMt ?? 0), 0);
  const balanceMt = producedMt != null ? Math.max(0, totalTargetMt - producedMt) : null;
  const pill = manualRerollStatusToPill(sessionStatus);
  const allocation = useMemo(() => {
    if (producedMt == null || !Number.isFinite(producedMt)) return null;
    return allocateCombinedWeight(
      orders.map((o) => ({ batchNumber: o.batchNumber, targetMt: o.weightMt ?? 0 })),
      producedMt,
    );
  }, [orders, producedMt]);

  return (
    <div className="shrink-0 space-y-2 px-3 pt-2">
      <div className="rounded-xl border border-success/30 bg-success/5 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-success">
          Combined production · {orders.length} active orders
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Tap an order card for full details. Enter one combined actual weight below.
        </p>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-white/80 border border-border/50 px-2 py-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Target</p>
            <p className="font-mono text-sm font-bold">{totalTargetMt.toFixed(3)} MT</p>
          </div>
          <div className="rounded-lg bg-white/80 border border-border/50 px-2 py-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Produced</p>
            <p className="font-mono text-sm font-bold text-primary">
              {producedMt != null ? `${producedMt.toFixed(3)} MT` : '—'}
            </p>
          </div>
          <div className="rounded-lg bg-white/80 border border-border/50 px-2 py-1.5">
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Balance</p>
            <p className="font-mono text-sm font-bold">
              {balanceMt != null ? `${balanceMt.toFixed(3)} MT` : '—'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {orders.map((order) => {
          const isSelected = selectedBatch === order.batchNumber;
          const targetMt = order.weightMt ?? 0;
          const allocated = allocation?.get(order.batchNumber);
          return (
            <button
              key={order.batchNumber}
              type="button"
              onClick={() => onSelect(order.batchNumber)}
              className={[
                'rounded-xl border bg-white p-3 text-left transition-all',
                'hover:border-primary/40 hover:shadow-sm',
                isSelected ? 'border-primary ring-2 ring-primary/20 shadow-sm' : 'border-border',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-mono text-sm font-bold truncate block">
                    {displayMotherCoilId(order)}
                  </span>
                  <p className="text-[10px] text-muted-foreground mt-1 font-mono">
                    Batch {order.batchNumber}
                  </p>
                </div>
                <SixHiStatusPill status={pill.status} preparing={pill.preparing} />
              </div>
              <p className="text-xs mt-2">
                <span className="font-semibold text-foreground">
                  {allocated != null ? allocated.toFixed(3) : '—'}
                </span>
                <span className="text-muted-foreground"> / {targetMt} MT</span>
              </p>
              {isSelected && (
                <p className="text-[10px] font-bold uppercase tracking-widest text-primary mt-2">
                  Viewing details →
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Full-bleed production console — same shell as SixHi rolling workspace. */
export function ManualRerollWorkspaceModal({
  open,
  session,
  machine,
  context,
  actionRail,
  onClose,
  onSaved,
}: ManualRerollWorkspaceModalProps) {
  const orders = useMemo(() => {
    if (context?.orders && context.orders.length > 0) return context.orders;
    if (!session) return [] as ManualRerollOrderSummary[];
    const batches = session.batchNumbers?.length
      ? session.batchNumbers
      : (session.batchNumber ? [session.batchNumber] : []);
    return batches.map((batchNumber) => ({
      batchNumber,
      coilNo: context?.coilNo,
      customer: context?.customer,
      grade: context?.grade,
      widthMm: context?.widthMm,
      thkMm: context?.thkMm,
      weightMt: context?.weightMt,
      slitId: context?.slitId,
      rollFinish: context?.rollFinish,
    }));
  }, [context, session]);

  const isCombined = orders.length > 1;
  const [detailBatch, setDetailBatch] = useState<string | null>(null);

  useEffect(() => {
    setDetailBatch(null);
  }, [open, session?.sessionId, isCombined]);

  const activeDetail = detailBatch
    ? (orders.find((o) => o.batchNumber === detailBatch) ?? null)
    : null;

  if (!open || !session) return null;

  const title = isCombined
    ? `Combined run · ${orders.length} orders`
    : displayMotherCoilId({
      coilNo: context?.coilNo,
      batchNumber: session.batchNumber,
      slitId: context?.slitId ?? undefined,
    });
  const subtitle = isCombined
    ? orders.map((o) => displayMotherCoilId(o)).join(', ')
    : [session.batchNumber, context?.customer, context?.grade].filter(Boolean).join(' · ');
  const pill = manualRerollStatusToPill(session.status);
  const primaryOrder = orders[0];

  return (
    <>
      <div className={overlayClass('fixed inset-0 z-[90] bg-primary/40', 'backdrop-blur-[2px]')} onClick={onClose} aria-hidden />
      <div
        className="fixed inset-y-0 left-16 right-0 z-[95] flex overflow-hidden shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Production workspace"
      >
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-secondary">
          <div className="shrink-0 flex items-center justify-between px-4 py-3 bg-primary text-white h-16">
            <div className="flex items-center gap-3 min-w-0">
              <p className="text-base font-bold shrink-0">Production Console</p>
              <span className="font-mono text-lg font-bold truncate">{title}</span>
              <SixHiStatusPill status={pill.status} preparing={pill.preparing} large />
              {subtitle && (
                <span className="text-sm opacity-80 hidden sm:inline truncate">{subtitle}</span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="min-h-10 min-w-10 flex items-center justify-center rounded-lg hover:bg-white/10 shrink-0"
              aria-label="Close workspace"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 min-h-0 flex overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
              {isCombined && (
                <CombinedOrdersStrip
                  orders={orders}
                  selectedBatch={detailBatch}
                  onSelect={setDetailBatch}
                  producedMt={session.actualWeightMt}
                  sessionStatus={session.status}
                />
              )}
              <div className="p-2 flex flex-col min-h-0 gap-2">
                {/* Single only — combined details live in the strip + slide panel (rolling parity). */}
                {!isCombined && primaryOrder && (
                  <PPCInfoCards data={toPpcSource(primaryOrder, context)} compact />
                )}
                <ManualRerollCaptureForm
                  key={`${session.sessionId}-${session.status}`}
                  session={session}
                  machine={machine}
                  context={context}
                  onSaved={onSaved}
                />
              </div>
            </div>

            {activeDetail && (
              <ManualRerollOrderDetailAside
                order={activeDetail}
                context={context}
                onClose={() => setDetailBatch(null)}
              />
            )}
          </div>
        </div>

        {actionRail}
      </div>
    </>
  );
}
