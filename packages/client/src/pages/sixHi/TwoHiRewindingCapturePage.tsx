import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { X } from 'lucide-react';
import { RwdTensionForm } from '../../components/process/bodies/RwdTensionForm';
import { ProcessPPCCards } from '../../components/process/ProcessPPCCards';
import { ProductionActionRail } from '../../components/process/ProductionActionRail';
import { OrderStoppageModal } from '../../components/sixHi/OrderStoppageModal';
import { OrderEndModal } from '../../components/sixHi/OrderEndModal';
import { OrderRejectionModal } from '../../components/sixHi/OrderRejectionModal';
import {
  CombinedProductionOrdersPanel,
  type CombinedPanelOrder,
} from '../../components/sixHi/CombinedProductionOrdersPanel';
import { ZButton } from '../../components/primitives/ZButton';
import { ZBadge } from '../../components/primitives/ZBadge';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { useShiftStore } from '../../store/shiftStore';
import { useAuthStore } from '../../lib/authStore';
import { apiClient } from '../../lib/apiClient';
import { displayMotherCoilId } from '../../lib/sixHiOrderIdentity';
import { notifyProductionChanged } from '../../lib/productionSync';
import { formatOrderStatusLabel } from '../../lib/orderLabels';
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
import type { CombinedProductionRun } from '../../store/sixHiStore';
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
  const [combinedPicked, setCombinedPicked] = useState<string[]>(
    () => seeded?.combinedBatchNumbers?.filter(Boolean) ?? [],
  );
  const isCombinedRun = combinedBatchNumbers.length > 1;
  const [loadError, setLoadError] = useState<string | null>(null);
  const seededStatus = (seeded?.orderStatus ?? '').toUpperCase();
  const [orderStatus, setOrderStatus] = useState<string>(
    seededStatus || 'PENDING',
  );
  const canSelectCombined = isCombinedRun
    && (orderStatus === 'PENDING' || orderStatus === 'PREPARING' || orderStatus === 'HOLD' || orderStatus === 'REJECTED');
  const [prodStartAt, setProdStartAt] = useState<string | undefined>();
  const [stoppageStartedAt, setStoppageStartedAt] = useState<string | undefined>();
  const [activeStoppageId, setActiveStoppageId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [stoppageOpen, setStoppageOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const isCompleted = orderStatus === 'COMPLETED';
  const refreshOrder = async (bn: string) => {
    if (!bn) return;
    try {
      const order = await fetchRwdOrder(bn) as {
        status: string;
        coilNo?: string;
        prodStartAt?: string;
        activeStoppageId?: string;
        combinedGroupId?: string;
        finishWeightMt?: number;
        rwTension1Kg?: number;
        rwTension2Kg?: number;
        rwTension3Kg?: number;
        outputThkMm?: number;
        surfaceFinish?: 'M' | 'B';
        stoppages?: Array<{ stoppageId: string; startAt: string; endAt?: string }>;
      };
      setOrderStatus(order.status);
      setProdStartAt(order.prodStartAt);
      setActiveStoppageId(order.activeStoppageId);
      const open = order.stoppages?.find((s) => !s.endAt);
      setStoppageStartedAt(open?.startAt);
      // Merge saved capture onto prefill so RwdTensionForm always shows last save.
      setPrefill((prev) => ({
        ...prev,
        finishWeightMt: order.finishWeightMt,
        rwTension1Kg: order.rwTension1Kg,
        rwTension2Kg: order.rwTension2Kg,
        rwTension3Kg: order.rwTension3Kg,
        outputThkMm: order.outputThkMm,
        ...(order.surfaceFinish ? { surfaceFinish: order.surfaceFinish } : {}),
      }));
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
          if (siblings.length > 1) {
            setCombinedBatchNumbers(siblings);
            setCombinedPicked((prev) => {
              const kept = prev.filter((b) => siblings.includes(b));
              return kept.length > 0 ? kept : siblings;
            });
          }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/coil resolve; refreshOrder is intentionally unstable
  }, [coilNo, seeded?.batchNumber, machineCode]);

  // When hub passes a new batch via location.state while staying on same coil route.
  useEffect(() => {
    if (!seeded?.batchNumber) return;
    setBatchNumber(seeded.batchNumber);
    if (seeded.orderStatus) setOrderStatus(String(seeded.orderStatus).toUpperCase());
    void refreshOrder(seeded.batchNumber).catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- react to hub batch handoff only
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

  const combinedRun = useMemo((): CombinedProductionRun | null => {
    if (combinedBatchNumbers.length < 2) return null;
    const primary = combinedPicked.includes(batchNumber)
      ? batchNumber
      : (combinedPicked[0] ?? combinedBatchNumbers[0]);
    return {
      primaryBatchNumber: primary || combinedBatchNumbers[0],
      batchNumbers: combinedBatchNumbers,
      orders: combinedBatchNumbers.map((bn) => ({
        batchNumber: bn,
        motherCoil: coilNo,
        customer: String(pv<string>(prefill.customerName) ?? '—'),
        weightMt: Number(pv<number>(prefill.weightMt) ?? 0),
        slitId: pv<string>(prefill.slitId),
      })),
    };
  }, [combinedBatchNumbers, combinedPicked, batchNumber, coilNo, prefill]);

  const loadCombinedOrders = useCallback(async (batchNumbers: string[]): Promise<CombinedPanelOrder[]> => {
    const loaded = await Promise.all(
      batchNumbers.map(async (bn) => {
        try {
          const order = await fetchRwdOrder(bn) as CombinedPanelOrder & {
            displayCoilNo?: string;
            customerName?: string;
            ppcWeightMt?: number;
            finishWeightMt?: number | null;
          };
          return {
            batchNumber: bn,
            coilNo: order.coilNo ?? order.displayCoilNo,
            slitId: order.slitId,
            status: order.status,
            ppcWeightMt: order.ppcWeightMt,
            weightMt: order.ppcWeightMt,
            finishWeightMt: order.finishWeightMt,
          };
        } catch {
          return { batchNumber: bn, coilNo, weightMt: 0 };
        }
      }),
    );
    return loaded;
  }, [coilNo]);

  const toggleCombinedPick = useCallback((bn: string) => {
    setCombinedPicked((prev) => {
      if (prev.includes(bn)) return prev.filter((b) => b !== bn);
      if (!combinedBatchNumbers.includes(bn)) return prev;
      return [...prev, bn];
    });
  }, [combinedBatchNumbers]);

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
            {displayMotherCoilId({
              displayCoilNo: prefill.displayCoilNo != null ? String(prefill.displayCoilNo) : undefined,
              coilNo,
              batchNumber: batchNumber || coilNo,
              slitId: pv<string>(prefill.slitId),
            })}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isCombinedRun && (
            <ZBadge tone="success" label={`Combined · ${combinedBatchNumbers.length}`} />
          )}
          <ZBadge
            tone={
              orderStatus === 'PENDING' || orderStatus === 'HOLD' || orderStatus === 'REJECTED' ? 'accent'
                : orderStatus === 'IN_PROGRESS' || orderStatus === 'RUNNING' ? 'success'
                  : orderStatus === 'STOPPAGE' ? 'warning'
                    : orderStatus === 'PREPARING' ? 'info'
                      : 'muted'
            }
            label={formatOrderStatusLabel(orderStatus)}
            dot={orderStatus === 'IN_PROGRESS'}
          />
          <ZButton
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => navigate(backPath)}
            className="!min-h-10 !h-10 !w-10 !px-0 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
            aria-label="Back to hub"
          >
            <X className="h-5 w-5" />
          </ZButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain w-full">
        {/* ponytail: drop max-w-4xl — fill operator main (nav + action rail already inset) */}
        <div className="p-3 flex flex-col gap-3 w-full">
          {loadError && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {loadError}
            </div>
          )}
          {!shiftLogId && (
            <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
              No active shift — start or join a shift before submitting.
            </div>
          )}

          <ProcessPPCCards compact data={ppc} />

          {combinedRun && (
            <CombinedProductionOrdersPanel
              combinedRun={combinedRun}
              variant="capture"
              selectedBatch={batchNumber}
              onSelectBatch={(bn) => {
                setBatchNumber(bn);
                void refreshOrder(bn);
              }}
              selectable={canSelectCombined}
              selectedBatches={combinedPicked}
              onToggleSelected={toggleCombinedPick}
              loadOrders={loadCombinedOrders}
            />
          )}

          <div className="bg-card border border-border rounded-xl shadow w-full">
            {isCombinedRun && (
              <p className="px-3 pt-3 text-xs text-muted-foreground">
                Combined run · weight is the group total and splits across siblings on Save.
              </p>
            )}
            <RwdTensionForm
              formId={FORM_ID}
              showSubmit={false}
              coilNo={coilNo}
              prefill={prefill}
              shiftLogId={shiftLogId ?? ''}
              machineCode={machineCode}
              batchNumber={batchNumber || undefined}
              onSubmitted={() => {
                // Save keeps order running — End rail completes.
                notifyProductionChanged();
                if (batchNumber) void refreshOrder(batchNumber);
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
          disabled={!shiftLogId || railStatus === 'idle' || isCompleted}
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
        busy={busy || !batchNumber || isCompleted || (canSelectCombined && combinedPicked.length === 0)}
        onStart={() =>
          void withBusy(async () => {
            if (isCompleted) return;
            const picks = combinedPicked.filter((b) => combinedBatchNumbers.includes(b));
            const startable = orderStatus === 'PENDING' || orderStatus === 'PREPARING' || orderStatus === 'STOPPAGE';
            if (!startable) return;
            if (picks.length >= 2) {
              await startCombinedRwdOrders(picks, machineCode === '2HI' ? '2HI' : 'RWD');
              setCombinedBatchNumbers(picks);
              setCombinedPicked(picks);
              const primary = picks.includes(batchNumber) ? batchNumber : picks[0];
              if (primary && primary !== batchNumber) setBatchNumber(primary);
              await refreshOrder(primary || batchNumber);
            } else if (picks.length === 1) {
              await startRwdOrder(picks[0]);
              setCombinedBatchNumbers(picks);
              setCombinedPicked(picks);
              setBatchNumber(picks[0]);
              await refreshOrder(picks[0]);
            } else if (batchNumber) {
              await startRwdOrder(batchNumber);
              await refreshOrder(batchNumber);
            }
          })
        }
        onEnd={() => {
          if (isCompleted) return;
          setEndOpen(true);
        }}
        onStoppage={() => { if (!isCompleted) setStoppageOpen(true); }}
        onRemark={() => { if (!isCompleted) setRejectOpen(true); }}
        onHold={() => { if (!isCompleted) setRejectOpen(true); }}
      />

      <OrderEndModal
        open={endOpen && !!batchNumber}
        batchNumber={batchNumber}
        orderLabel={`Rewinding · ${coilNo}`}
        appliesTo={machineCode === '2HI' || machineCode === 'RWD' ? 'RWD' : machineCode}
        onClose={() => setEndOpen(false)}
        onConfirm={async () => {
          try {
            await endRwdOrder(batchNumber);
            useProcessStore.getState().finishCapture();
            notifyProductionChanged();
            navigate(machineCode === '2HI'
              ? `${basePath}?tab=rewinding&status=COMPLETED`
              : `${backPath}?status=COMPLETED`);
          } catch (e: unknown) {
            setLoadError(e instanceof Error ? e.message : 'End failed');
            throw e;
          }
        }}
      />

      <OrderStoppageModal
        open={stoppageOpen && !isCompleted}
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

      <OrderRejectionModal
        open={rejectOpen && !!batchNumber}
        batchNumber={batchNumber}
        orderLabel={`Rewinding · ${coilNo}`}
        onClose={() => setRejectOpen(false)}
        onReject={async (_bn, rejectionReason, _defects, remarks) => {
          await rejectRwdOrder(batchNumber, rejectionReason, remarks);
          useProcessStore.getState().finishCapture();
          notifyProductionChanged();
          navigate(backPath);
        }}
      />
    </div>
  );
}
