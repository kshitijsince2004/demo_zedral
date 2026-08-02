import { useEffect, useState, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Play } from 'lucide-react';
import useSWR from 'swr';
import { useSixHiStore } from '../../store/sixHiStore';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { formatPlantClock, formatShiftDate } from '../../lib/dateFormat';
import { useShiftStore } from '../../store/shiftStore';
import { subscribeProductionChanged } from '../../lib/productionSync';
import { SixHiStatusPill } from '../../components/sixHi/SixHiStatusPill';
import { CombinedProductionOrdersPanel } from '../../components/sixHi/CombinedProductionOrdersPanel';
import { ShiftStoppageHistory } from '../../components/sixHi/ShiftStoppageHistory';
import { NetProductionTimerText, StoppageTimerText } from '../../components/sixHi/ProductionTimerDisplay';
import { ZButton } from '../../components/primitives/ZButton';
import { apiClient, ApiError } from '../../lib/apiClient';
import { networkAwareRefreshInterval, shouldPauseLivePolling } from '../../lib/networkAwareInterval';
import { resolveStoppageDisplayCode } from '../../components/sixHi/SixHiStoppageCodes';
import { canRecordStoppage } from '../../lib/sixHiRuntime';
import { displayMotherCoilId, selectIdOf } from '../../lib/sixHiOrderIdentity';
import { combinedTargetMt, resolveCombinedActualMt } from '../../lib/combinedWeightAllocation';
import { jsonEqual } from '../../lib/silentRefresh';
import type { SixHiOrderDetail, SixHiQueueCard } from '@m1/shared-validation';

function orderProductLabel(order: SixHiOrderDetail) {
  const processLabel = order.subProcess === 'ROLLING' ? 'Rolling' : 'Skin Pass';
  return `${order.grade} · ${processLabel}`;
}

function producedMt(order: SixHiOrderDetail) {
  return order.rolling?.actualWeightMt ?? order.skinPass?.actualWeightMt ?? 0;
}

function stoppageDisabledReason(order: SixHiOrderDetail | null): string | null {
  if (!order) return 'No active order';
  if (order.activeStoppage) return null;
  if (order.status === 'IN_PROGRESS') return null;
  if (order.status === 'STOPPAGE') return null;
  if (order.status === 'PENDING' || order.status === 'PREPARING') {
    return 'Start production before recording a stoppage';
  }
  return 'Stoppage is not available for this order';
}

export function SixHiCapturePage() {
  const navigate = useNavigate();
  const { basePath } = useWorkspaceBase();
  const { shiftLogId, shiftDate, shiftCode } = useShiftStore();
  const panelOrder = useSixHiStore((s) => s.panelOrder);
  const machineActive = useSixHiStore((s) => s.machineActive);
  const machineCode = useSixHiStore((s) => s.machineCode);
  const combinedRun = useSixHiStore((s) => s.combinedRun);
  const manualStoppage = useSixHiStore((s) => s.manualStoppage);
  const openWorkspace = useSixHiStore((s) => s.openWorkspace);
  const loadPanelOrder = useSixHiStore((s) => s.loadPanelOrder);
  const refreshMachineState = useSixHiStore((s) => s.refreshMachineState);
  const openStoppageDialog = useSixHiStore((s) => s.openStoppageDialog);
  const hydrateCombinedRunFromQueue = useSixHiStore((s) => s.hydrateCombinedRunFromQueue);

  const [stoppageError, setStoppageError] = useState<string | null>(null);
  const [combinedOrders, setCombinedOrders] = useState<SixHiOrderDetail[]>([]);
  const combinedOrdersFpRef = useRef('');

  const isCombinedRun = !!combinedRun && combinedRun.batchNumbers.length > 1;

  useEffect(() => {
    refreshMachineState();

    const tick = async () => {
      if (await shouldPauseLivePolling()) return;
      void useSixHiStore.getState().refreshMachineState();
    };
    void tick();
    const id = setInterval(() => void tick(), 15000);
    return () => clearInterval(id);
  }, [refreshMachineState]);

  const queueDate = formatShiftDate(shiftDate);
  const queueShift = shiftCode || undefined;
  const { data: queueData, mutate: mutateQueue } = useSWR(
    machineCode ? ['capture-queue', machineCode, queueDate, queueShift, shiftLogId] : null,
    async () => {
      const params = new URLSearchParams({ machine: machineCode, date: queueDate });
      if (queueShift) params.set('shift', queueShift);
      if (shiftLogId) params.set('shiftLogId', shiftLogId);
      const qs = params.toString();
      const [rolling, skinPass] = await Promise.all([
        apiClient.get(`/6hi/queue?${qs}&subProcess=ROLLING`),
        apiClient.get(`/6hi/queue?${qs}&subProcess=SKIN_PASS`),
      ]);
      const merged: SixHiQueueCard[] = [
        ...(rolling.queue ?? []),
        ...(skinPass.queue ?? []),
      ].sort((a, b) => a.queuePosition - b.queuePosition);
      return merged;
    },
    {
      refreshInterval: networkAwareRefreshInterval(15000),
      revalidateOnFocus: false,
      compare: (a, b) => jsonEqual(a, b),
    },
  );
  const allQueueItems = useMemo(() => queueData ?? [], [queueData]);

  const activeBatch = machineActive?.batchNumber ?? null;
  const runningFromQueue = allQueueItems.find(
    (q) => q.status === 'IN_PROGRESS' || q.status === 'STOPPAGE',
  );
  const effectiveBatch = activeBatch ?? runningFromQueue?.batchNumber ?? null;

  useEffect(() => {
    if (effectiveBatch && allQueueItems.length > 0) {
      hydrateCombinedRunFromQueue(allQueueItems, machineCode, effectiveBatch);
    }
  }, [effectiveBatch, allQueueItems, machineCode, hydrateCombinedRunFromQueue]);

  useEffect(() => {
    if (!effectiveBatch) return;
    if (!panelOrder || panelOrder.batchNumber !== effectiveBatch) {
      loadPanelOrder(effectiveBatch);
      return;
    }
    if (
      (panelOrder.status === 'IN_PROGRESS' || panelOrder.status === 'STOPPAGE')
      && !panelOrder.prodStartAt
    ) {
      loadPanelOrder(effectiveBatch);
    }
  }, [effectiveBatch, panelOrder, loadPanelOrder]);

  const order = effectiveBatch && panelOrder?.batchNumber === effectiveBatch ? panelOrder : null;
  const preparingOrder = allQueueItems.find(
    (q) => q.status === 'PREPARING' && q.batchNumber !== effectiveBatch,
  );

  const combinedBatchNumbersKey = combinedRun?.batchNumbers.join(',') ?? '';

  useEffect(() => {
    if (!isCombinedRun || !combinedBatchNumbersKey) {
      combinedOrdersFpRef.current = '';
      setCombinedOrders([]);
      return;
    }
    const batchNumbers = combinedBatchNumbersKey.split(',');
    let cancelled = false;
    void Promise.all(
      batchNumbers.map((batchNumber) =>
        apiClient.get<SixHiOrderDetail>(`/6hi/orders/${encodeURIComponent(batchNumber)}`),
      ),
    ).then((orders) => {
      if (cancelled) return;
      const fingerprint = JSON.stringify(orders);
      if (fingerprint === combinedOrdersFpRef.current) return;
      combinedOrdersFpRef.current = fingerprint;
      setCombinedOrders(orders);
    });
    return () => {
      cancelled = true;
    };
  }, [isCombinedRun, combinedBatchNumbersKey, order?.rolling?.actualWeightMt, order?.skinPass?.actualWeightMt]);

  const nextOrder =
    allQueueItems.find((q) => q.batchNumber !== order?.batchNumber && (q.status === 'PREPARING' || q.status === 'PENDING')) ??
    allQueueItems.find((q) => q.batchNumber !== order?.batchNumber);

  const { data: shiftStoppages, mutate: mutateShiftStoppages } = useSWR(
    shiftLogId ? `/6hi/shift/${shiftLogId}/stoppages?machine=${machineCode}` : null,
    async (url) => apiClient.get(url),
    {
      refreshInterval: networkAwareRefreshInterval(15000),
      revalidateOnFocus: false,
      compare: (a, b) => jsonEqual(a, b),
    },
  );

  useEffect(() => {
    return subscribeProductionChanged(() => {
      void mutateShiftStoppages();
      void mutateQueue();
      void refreshMachineState();
    });
  }, [mutateShiftStoppages, mutateQueue, refreshMachineState]);

  // Manual stoppages don't always fire production-changed — refresh history when active flips.
  useEffect(() => {
    void mutateShiftStoppages();
  }, [manualStoppage?.active?.eventId, mutateShiftStoppages]);

  const hasOrderStoppage = !!order?.activeStoppage;
  const hasManualStoppage = !!manualStoppage?.active;
  const hasActiveStoppage = hasOrderStoppage || hasManualStoppage;
  const stoppageAllowed = canRecordStoppage(order);
  const stoppageReason = stoppageDisabledReason(order);

  const openStoppage = async () => {
    if (!order?.batchNumber) return;
    setStoppageError(null);
    if (!stoppageAllowed) {
      setStoppageError(stoppageReason ?? 'Stoppage is not available right now');
      return;
    }
    try {
      await openStoppageDialog(order.batchNumber);
      mutateShiftStoppages();
    } catch (err) {
      const message = err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Failed to start stoppage';
      setStoppageError(message);
    }
  };

  const targetMt = isCombinedRun && combinedRun
    ? combinedTargetMt(combinedRun.orders.map((o) => ({ targetMt: o.weightMt })))
    : (order?.ppcWeightMt ?? 0);
  const produced = isCombinedRun && combinedOrders.length > 0
    ? (resolveCombinedActualMt(combinedOrders.map(producedMt)) ?? 0)
    : (order ? producedMt(order) : 0);
  const balance = Math.max(0, targetMt - produced);

  const historyRows = (Array.isArray(shiftStoppages) ? shiftStoppages : []).map((s: {
    id: string;
    startAt: string;
    endAt?: string;
    durationMin?: number;
    categoryCode: string;
    categoryLabel: string;
    breakdownCode?: string;
    remarks?: string;
    batchNumber?: string;
  }) => ({
    id: s.id,
    startTime: s.startAt,
    endTime: s.endAt ?? null,
    durationMins: s.durationMin ?? null,
    categoryCode: resolveStoppageDisplayCode(s.categoryCode, s.breakdownCode),
    categoryName: s.batchNumber
      ? s.categoryLabel
      : `${s.categoryLabel} (Manual)`,
    remarks: s.remarks ?? null,
  }));

  const openProductionForm = () => {
    if (!order) return;
    const detected = hydrateCombinedRunFromQueue(allQueueItems, machineCode, order.batchNumber);
    const run = detected ?? useSixHiStore.getState().combinedRun;
    openWorkspace(run?.primaryBatchNumber ?? order.batchNumber);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-secondary p-4 md:p-5 gap-4 overflow-hidden">
      <div className="shrink-0 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">Machine Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{machineCode} · Live production status</p>
        </div>
        {order && (
          <ZButton
            variant={hasActiveStoppage ? 'primary' : 'secondary'}
            size="lg"
            className="min-h-12"
            disabled={!stoppageAllowed}
            onClick={() => void openStoppage()}
            title={!stoppageAllowed ? stoppageReason ?? undefined : undefined}
          >
            <AlertTriangle className="h-5 w-5" />
            {hasActiveStoppage ? 'Manage Stoppage' : 'Stoppage'}
          </ZButton>
        )}
      </div>

      {stoppageError && (
        <div className="shrink-0 bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 text-sm text-destructive flex items-center justify-between gap-3">
          <p>{stoppageError}</p>
          <button type="button" className="text-xs underline shrink-0" onClick={() => setStoppageError(null)}>Dismiss</button>
        </div>
      )}

      {order?.activeStoppage && (
        <div className="shrink-0 bg-destructive/10 border border-destructive/30 rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">Stoppage Active</p>
            <p className="text-sm font-semibold text-destructive mt-1">
              Code {resolveStoppageDisplayCode(order.activeStoppage.categoryCode, order.activeStoppage.breakdownCode)} · {order.activeStoppage.categoryLabel}
            </p>
            <p className="text-xs text-destructive/80 mt-1">
              Started {formatPlantClock(order.activeStoppage.startAt)}
              {order.activeStoppage.remarks ? ` · ${order.activeStoppage.remarks}` : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-destructive/80">Duration</p>
            <StoppageTimerText
              startAt={order.activeStoppage.startAt}
              active
              className="font-mono text-3xl font-bold text-destructive"
            />
          </div>
        </div>
      )}

      {!order?.activeStoppage && manualStoppage?.active && (
        <div className="shrink-0 bg-destructive/10 border border-destructive/30 rounded-2xl px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">Manual Stoppage Active</p>
            <p className="text-sm font-semibold text-destructive mt-1">
              Code {resolveStoppageDisplayCode(manualStoppage.active.categoryCode, manualStoppage.active.breakdownCode)}
              {manualStoppage.active.categoryLabel ? ` · ${manualStoppage.active.categoryLabel}` : ''}
            </p>
            <p className="text-xs text-destructive/80 mt-1">
              Started {formatPlantClock(manualStoppage.active.startedAt)}
              {manualStoppage.active.reason ? ` · ${manualStoppage.active.reason}` : ''}
              {' · Manage from Status Rail'}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-destructive/80">Duration</p>
            <StoppageTimerText
              startAt={manualStoppage.active.startedAt}
              active
              className="font-mono text-3xl font-bold text-destructive"
            />
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-auto">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="bg-primary text-white px-5 py-3 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-90">
                  {isCombinedRun ? 'Combined Running Orders' : 'Current Running Order'}
                </p>
                {order && <SixHiStatusPill status={order.status} />}
              </div>
              {!order ? (
                <div className="p-6 text-center space-y-4">
                  {preparingOrder ? (
                    <>
                      <p className="text-sm font-semibold text-foreground">Order preparing — not started</p>
                      <p className="text-sm text-muted-foreground">
                        {preparingOrder.batchNumber} is ready in queue (pos {preparingOrder.queuePosition}).
                        Start production from Orders to begin capture.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-foreground">No order is running</p>
                      <p className="text-sm text-muted-foreground">Start production from Orders to begin capture.</p>
                    </>
                  )}
                  <ZButton variant="accent" onClick={() => navigate(basePath)}>
                    <ArrowRight className="h-4 w-4" />
                    Go to Orders
                  </ZButton>
                </div>
              ) : (
                <div className="p-5 space-y-4">
                  {isCombinedRun && combinedRun && (
                    <CombinedProductionOrdersPanel combinedRun={combinedRun} variant="capture" />
                  )}

                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {(isCombinedRun
                      ? [
                        ['Run type', `Combined · ${combinedRun!.batchNumbers.length} orders`],
                        ['Linked orders', combinedRun!.orders.map((o) => displayMotherCoilId(o)).join(', ')],
                        ['Product', orderProductLabel(order)],
                        ['Process', order.subProcess === 'ROLLING' ? 'Rolling' : 'Skin Pass'],
                        ['Combined Target', `${targetMt.toFixed(3)} MT`],
                        ['Combined Produced', `${produced.toFixed(3)} MT`],
                        ['Balance', `${balance.toFixed(3)} MT`],
                        ['Start Time', order.prodStartAt ? formatPlantClock(order.prodStartAt) : '—'],
                      ]
                      : [
                        ['Order', displayMotherCoilId(order)],
                        ['Slit ID', selectIdOf(order)],
                        ['Mother Coil', displayMotherCoilId(order)],
                        ['Product', orderProductLabel(order)],
                        ['Customer', order.customer],
                        ['Process', order.subProcess === 'ROLLING' ? 'Rolling' : 'Skin Pass'],
                        ['Target Quantity', `${targetMt.toFixed(3)} MT`],
                        ['Produced Quantity', `${produced.toFixed(3)} MT`],
                        ['Balance Quantity', `${balance.toFixed(3)} MT`],
                        ['Start Time', order.prodStartAt ? formatPlantClock(order.prodStartAt) : '—'],
                      ]
                    ).map(([label, value]) => (
                      <div key={label} className="bg-secondary rounded-xl px-3 py-3 min-h-[64px]">
                        <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</dt>
                        <dd className="font-mono text-sm font-semibold text-foreground mt-1 break-all">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  {order.prodStartAt && (
                    <p className="text-sm text-amber-600 font-semibold">
                      Net Runtime:{' '}
                      <NetProductionTimerText order={order} className="font-mono" />
                      {hasActiveStoppage && <span className="text-destructive ml-2">(paused)</span>}
                    </p>
                  )}

                  <ZButton
                    variant={hasActiveStoppage ? 'primary' : 'secondary'}
                    size="lg"
                    fullWidth
                    className="min-h-14"
                    disabled={!stoppageAllowed}
                    onClick={() => void openStoppage()}
                    title={!stoppageAllowed ? stoppageReason ?? undefined : undefined}
                  >
                    <AlertTriangle className="h-5 w-5" />
                    {hasActiveStoppage ? 'Manage Stoppage' : 'Record Stoppage'}
                  </ZButton>

                  <ZButton variant="accent" size="lg" fullWidth className="min-h-14" onClick={openProductionForm}>
                    <Play className="h-5 w-5" />
                    {isCombinedRun ? 'Open Combined Production Form' : 'Open Production Form'}
                  </ZButton>
                </div>
              )}
            </div>

            <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="bg-muted text-muted-foreground px-5 py-3 border-b border-border flex items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-widest">Upcoming Queue</p>
                <span className="text-xs font-semibold bg-white/50 px-2 py-0.5 rounded whitespace-nowrap shrink-0">
                  {allQueueItems.filter((q) => q.status === 'PENDING' || q.status === 'PREPARING').length} orders
                </span>
              </div>
              {!nextOrder ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No pending orders in queue.</div>
              ) : (
                <div className="p-5 space-y-4">
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      ['Order', displayMotherCoilId(nextOrder)],
                      ['Slit ID', selectIdOf(nextOrder)],
                      ['Product', `${nextOrder.grade} · ${nextOrder.subProcess === 'ROLLING' ? 'Rolling' : 'Skin Pass'}`],
                      ['Customer', nextOrder.customer],
                      ['Planned Quantity', `${nextOrder.weightMt} MT`],
                      ['Queue Position', String(nextOrder.queuePosition)],
                    ].map(([label, value]) => (
                      <div key={label} className="bg-secondary rounded-xl px-3 py-3 min-h-[64px]">
                        <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</dt>
                        <dd className="font-mono text-sm font-semibold text-foreground mt-1 break-all">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  {allQueueItems.filter((q) => q.status === 'PENDING' || q.status === 'PREPARING').length > 1 && (
                    <ul className="space-y-1 max-h-32 overflow-auto text-xs border-t border-border pt-3">
                      {allQueueItems
                        .filter((q) => (q.status === 'PENDING' || q.status === 'PREPARING') && q.batchNumber !== nextOrder.batchNumber)
                        .slice(0, 8)
                        .map((q) => (
                          <li key={q.batchNumber} className="flex justify-between gap-2 text-muted-foreground">
                            <span className="font-mono truncate">{displayMotherCoilId(q)}</span>
                            <span>Pos {q.queuePosition}</span>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          <ShiftStoppageHistory stoppages={historyRows} />
      </div>
    </div>
  );
}
