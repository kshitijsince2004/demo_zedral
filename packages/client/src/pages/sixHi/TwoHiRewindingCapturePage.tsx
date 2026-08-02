import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { RwdTensionForm } from '../../components/process/bodies/RwdTensionForm';
import { ProcessPPCCards } from '../../components/process/ProcessPPCCards';
import { ProductionActionRail } from '../../components/process/ProductionActionRail';
import { OrderStoppageModal } from '../../components/sixHi/OrderStoppageModal';
import { ZButton } from '../../components/primitives/ZButton';
import { ZBadge } from '../../components/primitives/ZBadge';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { useShiftStore } from '../../store/shiftStore';
import { useAuthStore } from '../../lib/authStore';
import { apiClient } from '../../lib/apiClient';
import { notifyProductionChanged } from '../../lib/productionSync';
import {
  addRwdStoppage,
  endRwdOrder,
  endRwdStoppage,
  fetchRwdOrder,
  rejectRwdOrder,
  startRwdOrder,
  startCombinedRwdOrders,
  updateRwdStoppage,
} from '../../lib/rewindingWrites';
import { useProcessStore } from '../../store/processStore';

type PrefillFieldLike<T> = { value: T; source?: string };

function pv<T>(f: unknown): T | undefined {
  if (f == null) return undefined;
  if (typeof f === 'object' && f !== null && 'value' in f) return (f as PrefillFieldLike<T>).value;
  return f as T;
}

const FORM_ID = 'twohi-rwd-capture-form';

type RailStatus = 'idle' | 'running' | 'stoppage';

function toRailStatus(status?: string): RailStatus {
  if (status === 'IN_PROGRESS') return 'running';
  if (status === 'STOPPAGE') return 'stoppage';
  return 'idle';
}

/** Rewinding capture for RWD line or 2HI Rewinding tab — not skin-pass. */
export function TwoHiRewindingCapturePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { coilNo: rawCoil } = useParams<{ coilNo: string }>();
  const coilNo = rawCoil ? decodeURIComponent(rawCoil) : '';
  const authMachine = useAuthStore((s) => s.activeMachine);
  const { basePath: millBase, machineCode: millCode } = useWorkspaceBase();
  const { basePath: processBase } = useProcessWorkspaceBase();
  const isRwdLine = authMachine === 'RWD';
  const machineCode = isRwdLine ? 'RWD' : millCode;
  const basePath = isRwdLine ? processBase : millBase;
  const shiftLogId = useShiftStore((s) => s.shiftLogId);

  const seeded = (location.state as {
    prefill?: Record<string, unknown>;
    batchNumber?: string;
    orderStatus?: string;
    combinedBatchNumbers?: string[];
  } | null);
  const [prefill, setPrefill] = useState<Record<string, unknown>>(seeded?.prefill ?? { displayCoilNo: coilNo });
  const [batchNumber, setBatchNumber] = useState(seeded?.batchNumber ?? '');
  const [combinedBatchNumbers, setCombinedBatchNumbers] = useState(
    () => seeded?.combinedBatchNumbers?.filter(Boolean) ?? [],
  );
  const isCombinedRun = combinedBatchNumbers.length > 1;
  const [loadError, setLoadError] = useState<string | null>(null);
  const seededStatus = (seeded?.orderStatus ?? '').toUpperCase();
  const [orderStatus, setOrderStatus] = useState<string>(
    seededStatus || 'PENDING',
  );
  const [prodStartAt, setProdStartAt] = useState<string | undefined>();
  const [stoppageStartedAt, setStoppageStartedAt] = useState<string | undefined>();
  const [activeStoppageId, setActiveStoppageId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [stoppageOpen, setStoppageOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdReason, setHoldReason] = useState('');
  const [holdRemarks, setHoldRemarks] = useState('');

  const refreshOrder = async (bn: string) => {
    if (!bn) return;
    try {
      const order = await fetchRwdOrder(bn) as {
        status: string;
        coilNo?: string;
        prodStartAt?: string;
        activeStoppageId?: string;
        combinedGroupId?: string;
        stoppages?: Array<{ stoppageId: string; startAt: string; endAt?: string }>;
      };
      setOrderStatus(order.status);
      setProdStartAt(order.prodStartAt);
      setActiveStoppageId(order.activeStoppageId);
      const open = order.stoppages?.find((s) => !s.endAt);
      setStoppageStartedAt(open?.startAt);
      // Restore combined siblings after refresh when navigation state was lost.
      if (order.combinedGroupId && combinedBatchNumbers.length <= 1) {
        try {
          const machine = machineCode === '2HI' ? '2HI' : 'RWD';
          const res = await apiClient.get<{ queue: Array<{ batchNumber: string; combinedGroupId?: string }> }>(
            `/rewinding/queue?machine=${encodeURIComponent(machine)}`,
          );
          const siblings = (res.queue ?? [])
            .filter((c) => c.combinedGroupId === order.combinedGroupId)
            .map((c) => c.batchNumber);
          if (siblings.length > 1) setCombinedBatchNumbers(siblings);
        } catch { /* keep seeded */ }
      }
      useProcessStore.getState().hydrateRwdRun({
        coilNo: order.coilNo || coilNo,
        batchNumber: bn,
        status: order.status,
        prodStartAt: order.prodStartAt,
        stoppageStartedAt: open?.startAt,
        activeStoppageId: order.activeStoppageId ?? null,
      });
    } catch {
      // Order may not exist yet (pre-Start) — keep seeded status.
    }
  };

  useEffect(() => {
    // Restore timer immediately if shell already knows this coil is running (no Idle flash).
    const s = useProcessStore.getState();
    if (s.activeCoilNo === coilNo || seeded?.batchNumber) {
      if (s.captureStatus === 'running' && s.runStartedAt) {
        setOrderStatus('IN_PROGRESS');
        setProdStartAt(s.runStartedAt);
      } else if (s.captureStatus === 'stoppage') {
        setOrderStatus('STOPPAGE');
        setProdStartAt(s.runStartedAt ?? undefined);
        setStoppageStartedAt(s.stoppageStartedAt ?? undefined);
        setActiveStoppageId(s.activeStoppageId ?? undefined);
      }
    }
  }, [coilNo, seeded?.batchNumber]);

  useEffect(() => {
    if (!coilNo) return;
    let cancelled = false;

    const resolveAndRefresh = async () => {
      const preferred = seeded?.batchNumber?.trim() || '';
      // 1) Prefer navigation batch (hub / Live) — never let entry AutoSource clobber it.
      if (preferred) {
        setBatchNumber(preferred);
        await refreshOrder(preferred);
      }

      // 2) Prefill fields from entry (plan) but do not trust its batch when we already have one.
      try {
        const data = await apiClient.get<Record<string, unknown>>(
          `/stations/RWD/entry/${encodeURIComponent(coilNo)}`,
        );
        if (cancelled) return;
        setPrefill((prev) => ({ ...prev, ...data }));
      } catch (err) {
        if (!cancelled && !seeded?.prefill) {
          setLoadError(err instanceof Error ? err.message : 'Prefill failed');
        }
      }

      if (preferred || cancelled) return;

      // 3) Cold open: pick IN_PROGRESS/STOPPAGE batch for this coil from queue (not latest plan row).
      try {
        const machine = machineCode === '2HI' ? '2HI' : 'RWD';
        const { pickRewindingBatchForCoil } = await import('../../lib/rewindingQueue');
        const res = await apiClient.get<{ queue: import('../../lib/rewindingQueue').RewindingQueueCard[] }>(
          `/rewinding/queue?machine=${encodeURIComponent(machine)}`,
        );
        if (cancelled) return;
        const card = pickRewindingBatchForCoil(res.queue ?? [], coilNo);
        if (card?.batchNumber) {
          setBatchNumber(card.batchNumber);
          if (card.status) setOrderStatus(String(card.status).toUpperCase());
          await refreshOrder(card.batchNumber);
        }
      } catch {
        /* keep PENDING until operator leaves */
      }
    };

    void resolveAndRefresh().catch(() => undefined);
    return () => { cancelled = true; };
  }, [coilNo, seeded?.batchNumber, machineCode]);

  // When hub passes a new batch via location.state while staying on same coil route.
  useEffect(() => {
    if (!seeded?.batchNumber) return;
    setBatchNumber(seeded.batchNumber);
    if (seeded.orderStatus) setOrderStatus(String(seeded.orderStatus).toUpperCase());
    void refreshOrder(seeded.batchNumber).catch(() => undefined);
  }, [seeded?.batchNumber, seeded?.orderStatus]);

  const ppc = useMemo(() => {
    const widthMm = pv<number>(prefill.widthMm);
    const thicknessMm = pv<number>(prefill.thicknessMm) ?? pv<number>(prefill.outputThkMmFallback);
    const grade = String(pv<string>(prefill.gradeCode) ?? '—');
    const display = String(prefill.displayCoilNo ?? coilNo);
    const surface = pv<'M' | 'B'>(prefill.surfaceFinish);
    return {
      coilNo: display,
      customer: String(pv<string>(prefill.customerName) ?? '—'),
      grade,
      slitId: pv<string>(prefill.slitId),
      widthMm,
      thicknessMm,
      weightMt: pv<number>(prefill.weightMt),
      batch: batchNumber || pv<string>(prefill.batchNumber),
      surface: surface ?? '',
      planWidthMm: widthMm,
      planThicknessMm: thicknessMm,
    };
  }, [prefill, coilNo, batchNumber]);

  const railStatus = toRailStatus(orderStatus);
  const backPath = machineCode === '2HI' ? `${basePath}?tab=rewinding` : basePath;

  if (!coilNo) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Select a coil from the Rewinding queue.
      </div>
    );
  }

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0 w-full bg-secondary overflow-hidden pr-[6.5rem]">
      <div className="shrink-0 bg-primary text-primary-foreground px-4 py-3 flex items-center justify-between gap-3 w-full">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-80">
            Rewinding · {machineCode}
          </p>
          <p className="font-mono text-lg font-bold truncate">
            {String(prefill.displayCoilNo ?? coilNo)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isCombinedRun && (
            <ZBadge tone="success" label={`Combined · ${combinedBatchNumbers.length}`} />
          )}
          <ZBadge
            tone={orderStatus === 'PENDING' ? 'accent' : orderStatus === 'IN_PROGRESS' ? 'info' : orderStatus === 'STOPPAGE' ? 'warning' : 'muted'}
            label={orderStatus}
          />
          <button
            type="button"
            onClick={() => navigate(backPath)}
            className="min-h-10 min-w-10 flex items-center justify-center rounded-lg hover:bg-white/10"
            aria-label="Back to hub"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain w-full">
        {/* ponytail: drop max-w-4xl — fill operator main (nav + action rail already inset) */}
        <div className="p-3 flex flex-col gap-3 w-full">
          {loadError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {loadError}
            </div>
          )}
          {!shiftLogId && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              No active shift — start or join a shift before submitting.
            </div>
          )}

          <ProcessPPCCards compact data={ppc} />

          <div className="bg-card border border-border rounded-xl shadow w-full">
            <RwdTensionForm
              formId={FORM_ID}
              showSubmit={false}
              coilNo={coilNo}
              prefill={prefill}
              shiftLogId={shiftLogId ?? ''}
              machineCode={machineCode}
              batchNumber={batchNumber || undefined}
              onSubmitted={() => {
                useProcessStore.getState().finishCapture();
                notifyProductionChanged();
                navigate(machineCode === '2HI' ? backPath : `${backPath}?status=COMPLETED`);
              }}
            />
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-card px-3 py-3 z-20 w-full">
        <ZButton
          type="submit"
          form={FORM_ID}
          variant="primary"
          size="lg"
          fullWidth
          disabled={!shiftLogId || railStatus === 'idle'}
          className="min-h-14 text-base font-bold"
        >
          Save Production Data
        </ZButton>
      </div>

      <ProductionActionRail
        coilNo={String(prefill.displayCoilNo ?? coilNo)}
        status={railStatus}
        stoppageStartedAt={stoppageStartedAt}
        runStartedAt={prodStartAt}
        busy={busy || !batchNumber}
        onStart={() =>
          void withBusy(async () => {
            if (isCombinedRun && (orderStatus === 'PENDING' || orderStatus === 'PREPARING' || orderStatus === 'STOPPAGE')) {
              await startCombinedRwdOrders(combinedBatchNumbers);
            } else {
              await startRwdOrder(batchNumber);
            }
            await refreshOrder(batchNumber);
          })
        }
        onEnd={() =>
          void withBusy(async () => {
            try {
              await endRwdOrder(batchNumber);
              useProcessStore.getState().finishCapture();
              notifyProductionChanged();
              navigate(machineCode === '2HI' ? `${backPath}` : `${backPath}?status=COMPLETED`);
            } catch (e: unknown) {
              setLoadError(e instanceof Error ? e.message : 'End failed');
              throw e;
            }
          })
        }
        onStoppage={() => setStoppageOpen(true)}
        onRemark={() => setHoldOpen(true)}
        onHold={() => setHoldOpen(true)}
      />

      <OrderStoppageModal
        open={stoppageOpen}
        hasActiveStoppage={railStatus === 'stoppage'}
        activeStoppage={
          activeStoppageId
            ? {
                id: activeStoppageId,
                categoryCode: 'BREAKDOWN',
                categoryLabel: 'Stoppage',
                startAt: stoppageStartedAt ?? new Date().toISOString(),
              }
            : undefined
        }
        subtitle={`Rewinding · ${coilNo}`}
        title={railStatus === 'stoppage' ? 'Manage Stoppage' : 'Start Stoppage'}
        onClose={() => setStoppageOpen(false)}
        onStart={async (categoryCode, breakdownCode, remarks) => {
          await addRwdStoppage(batchNumber, { categoryCode, breakdownCode, remarks });
          setStoppageOpen(false);
          await refreshOrder(batchNumber);
        }}
        onUpdate={async (stoppageId, categoryCode, breakdownCode, remarks) => {
          await updateRwdStoppage(batchNumber, stoppageId, { categoryCode, breakdownCode, remarks });
          await refreshOrder(batchNumber);
        }}
        onEnd={async (stoppageId) => {
          await endRwdStoppage(batchNumber, stoppageId);
          setStoppageOpen(false);
          await refreshOrder(batchNumber);
        }}
      />

      {holdOpen && (
        <>
          <div className="fixed inset-0 z-[110] bg-primary/40" onClick={() => setHoldOpen(false)} aria-hidden />
          <div className="fixed left-1/2 top-1/2 z-[115] w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-white p-5 shadow-2xl">
            <h3 className="font-bold text-lg mb-3">Hold Order</h3>
            <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Reason</label>
            <input
              className="w-full min-h-11 rounded-lg border border-input px-3 mb-3"
              value={holdReason}
              onChange={(e) => setHoldReason(e.target.value)}
            />
            <label className="block text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Remarks</label>
            <textarea
              className="w-full min-h-24 rounded-lg border border-input px-3 py-2 mb-4"
              value={holdRemarks}
              onChange={(e) => setHoldRemarks(e.target.value)}
            />
            <div className="flex gap-2">
              <ZButton variant="secondary" className="flex-1" onClick={() => setHoldOpen(false)}>Cancel</ZButton>
              <ZButton
                className="flex-1 bg-accent text-accent-foreground hover:bg-accent/90"
                disabled={!holdReason.trim() || !holdRemarks.trim() || busy}
                onClick={() =>
                  void withBusy(async () => {
                    await rejectRwdOrder(batchNumber, holdReason, holdRemarks);
                    setHoldOpen(false);
                    useProcessStore.getState().finishCapture();
                    notifyProductionChanged();
                    navigate(backPath);
                  })
                }
              >
                HOLD
              </ZButton>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
