import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Play } from 'lucide-react';
import useSWR from 'swr';
import { useSixHiStore } from '../../store/sixHiStore';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { formatShiftDate } from '../../lib/dateFormat';
import { useShiftStore } from '../../store/shiftStore';
import { SixHiShiftSummaryPanel } from '../../components/sixHi/SixHiShiftSummaryPanel';
import { SixHiStatusPill } from '../../components/sixHi/SixHiStatusPill';
import { ShiftStoppageHistory } from '../../components/sixHi/ShiftStoppageHistory';
import { ZButton } from '../../components/primitives/ZButton';
import { useNetProductionTimer } from '../../hooks/useNetProductionTimer';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { apiClient, ApiError } from '../../lib/apiClient';
import { resolveStoppageDisplayCode } from '../../components/sixHi/SixHiStoppageCodes';
import { canRecordStoppage } from '../../lib/sixHiRuntime';
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
  const {
    panelOrder,
    machineActive,
    machineCode,
    shiftSummary,
    openWorkspace,
    loadPanelOrder,
    loadShiftSummary,
    refreshMachineState,
    requestStoppageDialog,
  } = useSixHiStore();

  const [stoppageError, setStoppageError] = useState<string | null>(null);

  useEffect(() => {
    refreshMachineState();
    if (shiftLogId) loadShiftSummary(shiftLogId);
    const id = setInterval(() => {
      const store = useSixHiStore.getState();
      void store.refreshMachineState();
      const batch = store.machineActive?.batchNumber;
      if (batch) void store.loadPanelOrder(batch);
    }, 15000);
    return () => clearInterval(id);
  }, [shiftLogId, refreshMachineState, loadShiftSummary]);

  const activeBatch = machineActive?.batchNumber ?? null;

  useEffect(() => {
    if (activeBatch && (!panelOrder || panelOrder.batchNumber !== activeBatch)) {
      loadPanelOrder(activeBatch);
    }
  }, [activeBatch, panelOrder, loadPanelOrder]);

  const order = activeBatch && panelOrder?.batchNumber === activeBatch ? panelOrder : null;

  const queueDate = formatShiftDate(shiftDate);
  const queueShift = shiftCode || 'B';
  const { data: queueData } = useSWR(
    machineCode ? ['capture-queue', machineCode, queueDate, queueShift] : null,
    async () => {
      const params = `machine=${machineCode}&date=${queueDate}&shift=${queueShift}`;
      const [rolling, skinPass] = await Promise.all([
        apiClient.get(`/6hi/queue?${params}&subProcess=ROLLING`),
        apiClient.get(`/6hi/queue?${params}&subProcess=SKIN_PASS`),
      ]);
      const merged: SixHiQueueCard[] = [
        ...(rolling.queue ?? []),
        ...(skinPass.queue ?? []),
      ].sort((a, b) => a.queuePosition - b.queuePosition);

      const ctx = rolling.planDate ? rolling : skinPass;
      if (ctx.planDate) {
        useShiftStore.setState({
          shiftDate: formatShiftDate(ctx.planDate),
          shiftCode: (ctx.shiftCode ?? queueShift) as 'A' | 'B' | 'C',
        });
      }
      return merged;
    },
  );
  const allQueueItems = queueData ?? [];
  const nextOrder =
    allQueueItems.find((q) => q.batchNumber !== order?.batchNumber && (q.status === 'PREPARING' || q.status === 'PENDING')) ??
    allQueueItems.find((q) => q.batchNumber !== order?.batchNumber);

  const { data: shiftStoppages, mutate: mutateShiftStoppages } = useSWR(
    shiftLogId ? `/6hi/shift/${shiftLogId}/stoppages?machine=${machineCode}` : null,
    async (url) => apiClient.get(url),
    { refreshInterval: 15000 },
  );

  const hasActiveStoppage = !!order?.activeStoppage;
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
      await requestStoppageDialog?.(order.batchNumber);
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

  const netRuntime = useNetProductionTimer(order);
  const { formatted: stoppageTimer } = useLiveTimer(order?.activeStoppage?.startAt, hasActiveStoppage);

  const targetMt = order?.ppcWeightMt ?? 0;
  const produced = order ? producedMt(order) : 0;
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
  }) => ({
    id: s.id,
    startTime: s.startAt,
    endTime: s.endAt ?? null,
    durationMins: s.durationMin ?? null,
    categoryCode: resolveStoppageDisplayCode(s.categoryCode, s.breakdownCode),
    categoryName: s.categoryLabel,
    remarks: s.remarks ?? null,
  }));

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-secondary p-4 md:p-5 gap-4 overflow-hidden">
      <div className="shrink-0 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">Capture</h1>
          <p className="text-sm text-muted-foreground">{machineCode} · Shift {shiftCode} · {formatShiftDate(shiftDate)}</p>
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
              Started {new Date(order.activeStoppage.startAt).toLocaleTimeString()}
              {order.activeStoppage.remarks ? ` · ${order.activeStoppage.remarks}` : ''}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-bold uppercase tracking-widest text-destructive/80">Duration</p>
            <p className="font-mono text-3xl font-bold text-destructive">{stoppageTimer}</p>
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        <div className="flex flex-col min-h-0 gap-4 overflow-auto">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="bg-primary text-white px-5 py-3 flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest opacity-90">Current Running Order</p>
                {order && <SixHiStatusPill status={order.status} />}
              </div>
              {!order ? (
                <div className="p-6 text-center space-y-4">
                  <p className="text-sm font-semibold text-foreground">No order is running</p>
                  <p className="text-sm text-muted-foreground">Start production from Orders to begin capture.</p>
                  <ZButton variant="accent" onClick={() => navigate(basePath)}>
                    <ArrowRight className="h-4 w-4" />
                    Go to Orders
                  </ZButton>
                </div>
              ) : (
                <div className="p-5 space-y-4">
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      ['Order Number', order.batchNumber],
                      ['Product', orderProductLabel(order)],
                      ['Customer', order.customer],
                      ['Target Quantity', `${targetMt.toFixed(3)} MT`],
                      ['Produced Quantity', `${produced.toFixed(3)} MT`],
                      ['Balance Quantity', `${balance.toFixed(3)} MT`],
                      ['Start Time', order.prodStartAt ? new Date(order.prodStartAt).toLocaleTimeString() : '—'],
                    ].map(([label, value]) => (
                      <div key={label} className="bg-secondary rounded-xl px-3 py-3 min-h-[64px]">
                        <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</dt>
                        <dd className="font-mono text-sm font-semibold text-foreground mt-1 break-all">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  {order.prodStartAt && netRuntime && (
                    <p className="text-sm text-amber-600 font-semibold">
                      Net Runtime: <span className="font-mono">{netRuntime}</span>
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

                  <ZButton variant="accent" size="lg" fullWidth className="min-h-14" onClick={() => openWorkspace(order.batchNumber)}>
                    <Play className="h-5 w-5" />
                    Open Production Form
                  </ZButton>
                </div>
              )}
            </div>

            <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
              <div className="bg-muted text-muted-foreground px-5 py-3 border-b border-border flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-widest">Next Prepared Order</p>
                {nextOrder && (
                  <span className="text-xs font-semibold bg-white/50 px-2 py-0.5 rounded">
                    Queue Pos: {nextOrder.queuePosition}
                  </span>
                )}
              </div>
              {!nextOrder ? (
                <div className="p-6 text-center text-sm text-muted-foreground">No prepared order in queue.</div>
              ) : (
                <div className="p-5">
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      ['Order Number', nextOrder.batchNumber],
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
                </div>
              )}
            </div>
          </div>

          <ShiftStoppageHistory stoppages={historyRows} />
        </div>

        <div className="min-h-0 overflow-auto">
          <SixHiShiftSummaryPanel summary={shiftSummary} />
        </div>
      </div>
    </div>
  );
}
