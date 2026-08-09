import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useWorkspaceBase } from '../../../hooks/useWorkspaceBase';
import { useManualRerollEntry } from '../../../hooks/useTenantFlag';
import { hubTabsForMill } from '../../../lib/millConfig';
import {
  MANUAL_REROLL_STATUS_FILTERS,
  countRerollFilters,
  formatManualRerollConflict,
  formatRerollNetRuntime,
  formatRerollSummaryCard,
  matchesRerollStatusFilter,
  rerollCombineKey,
  rerollNetRuntimeMs,
  withManualRerollTab,
  type ManualRerollStatusFilter,
} from '../../../lib/manualRerollUi';
import { ApiError, getServerTime } from '../../../lib/apiClient';
import { notifyProductionChanged } from '../../../lib/productionSync';
import { SixHiPillTabs } from '../SixHiPillTabs';
import { ZPageHeader } from '../../ui/operator/ZPageHeader';
import { ZInput } from '../../primitives/ZInput';
import { ZButton } from '../../primitives/ZButton';
import { ZFilterPills } from '../../ui/operator/ZFilterPills';
import { OrderStoppageModal } from '../OrderStoppageModal';
import { ManualRerollActionRail } from './ManualRerollActionRail';
import { ManualRerollHoldModal } from './ManualRerollHoldModal';
import { ManualRerollWorkspaceModal } from './ManualRerollWorkspaceModal';
import {
  cancelManualReroll,
  endManualReroll,
  endManualRerollStoppage,
  holdManualReroll,
  prepareManualReroll,
  releaseManualRerollToPending,
  remarkManualReroll,
  startPreparedManualReroll,
  startManualRerollStoppage,
  updateManualRerollStoppage,
  useManualRerollQueue,
  useManualRerollSummary,
  type ManualRerollOrderHit,
  type ManualRerollSession,
  type ManualRerollSessionCard,
} from '../../../services/manualRerollService';
import { formatOrderStatusLabel } from '../../../lib/orderLabels';
import { useSixHiStore } from '../../../store/sixHiStore';

type QueueRow =
  | { kind: 'pending'; data: ManualRerollOrderHit }
  | { kind: 'session'; data: ManualRerollSessionCard };

function freeRemarks(remarks: string | null | undefined): string {
  if (!remarks) return '';
  return remarks.replace(/\[\[batches:[^\]]+\]\]\n?/g, '').trim();
}

export function ManualRerollHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { machineCode } = useWorkspaceBase();
  const { showEntry, canWrite } = useManualRerollEntry(machineCode);
  const tabs = withManualRerollTab(hubTabsForMill(machineCode), showEntry);

  const statusFilter = (searchParams.get('status')?.toUpperCase() || 'ALL') as ManualRerollStatusFilter;
  const [query, setQuery] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(query), 250);
    return () => window.clearTimeout(id);
  }, [query]);

  const { data: queue, mutate: mutateQueue } = useManualRerollQueue(machineCode, showEntry, debouncedQ);
  const { data: summary, mutate: mutateSummary } = useManualRerollSummary(machineCode, showEntry);
  const active = queue?.active ?? null;

  const [selectedPending, setSelectedPending] = useState<ManualRerollOrderHit | null>(null);
  const [selectedSession, setSelectedSession] = useState<ManualRerollSessionCard | null>(null);
  const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
  const [compatibleIds, setCompatibleIds] = useState<Set<string>>(new Set());
  const combineManualRef = useRef(false);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stoppageOpen, setStoppageOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [runOrders, setRunOrders] = useState<Array<{
    batchNumber: string;
    coilNo?: string;
    customer?: string;
    grade?: string | null;
    widthMm?: number | null;
    thkMm?: number | null;
    weightMt?: number | null;
    slitId?: string | null;
    rollFinish?: string | null;
  }>>([]);
  const [now, setNow] = useState(() => getServerTime());
  const refreshMachineState = useSixHiStore((s) => s.refreshMachineState);

  useEffect(() => {
    if (!active || active.status === 'ON_HOLD') return;
    const id = window.setInterval(() => setNow(getServerTime()), 1000);
    return () => window.clearInterval(id);
  }, [active?.sessionId, active?.status, active]);

  const setTab = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    next.delete('status');
    setSearchParams(next);
  };

  const setStatus = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'reroll');
    if (id === 'ALL') next.delete('status');
    else next.set('status', id);
    setSearchParams(next);
  };

  const pending = useMemo(() => queue?.pending ?? [], [queue?.pending]);
  const sessions = useMemo(() => queue?.sessions ?? [], [queue?.sessions]);

  const allRows: QueueRow[] = useMemo(() => [
    ...pending.map((p) => ({ kind: 'pending' as const, data: p })),
    ...sessions.map((s) => ({ kind: 'session' as const, data: s })),
  ], [pending, sessions]);

  const filterItems = useMemo(
    () => [
      ...pending.map((p) => ({ status: p.status || 'PENDING', kind: 'pending' as const })),
      ...sessions.map((s) => ({ status: s.status, kind: 'session' as const })),
    ],
    [pending, sessions],
  );
  const counts = countRerollFilters(filterItems);

  const filteredRows = allRows.filter((row) => {
    const status = row.kind === 'pending' ? (row.data.status || 'PENDING') : row.data.status;
    return matchesRerollStatusFilter(status, statusFilter, row.kind);
  });

  const pendingCombineKey = useMemo(
    () => pending.map((p) => `${p.orderId}:${p.coilNo}:${p.slitId}:${p.rollFinish}:${p.subProcess}`).join('|'),
    [pending],
  );

  const applyCombineSelection = useCallback((anchor: ManualRerollOrderHit, keepPicks = false) => {
    const pool = pending.filter((hit) => rerollCombineKey(hit) === rerollCombineKey(anchor));
    const poolIds = new Set(pool.map((hit) => hit.orderId));
    setCompatibleIds(poolIds);
    setPickedIds((prev) => {
      if (!keepPicks) return poolIds;
      const kept = new Set([...prev].filter((id) => poolIds.has(id)));
      if (!kept.has(anchor.orderId)) kept.add(anchor.orderId);
      return kept.size > 0 ? kept : new Set([anchor.orderId]);
    });
  }, [pending]);

  // Reconcile picks when queue refreshes; initial select applies sync below.
  useEffect(() => {
    if (!selectedPending) {
      setPickedIds(new Set());
      setCompatibleIds(new Set());
      combineManualRef.current = false;
      return;
    }
    applyCombineSelection(selectedPending, combineManualRef.current);
  }, [selectedPending, selectedPending?.orderId, pendingCombineKey, applyCombineSelection]);

  const picked = pending.filter((hit) => pickedIds.has(hit.orderId));
  const showCombine = compatibleIds.size > 1;
  const pickedWeightMt = picked.reduce((sum, hit) => sum + (hit.weightMt ?? 0), 0);

  const panelSession: ManualRerollSession | null = useMemo(() => {
    if (active) return active;
    if (selectedSession) {
      return {
        sessionId: selectedSession.sessionId,
        orderId: selectedSession.orderId,
        batchNumber: selectedSession.batchNumber,
        batchNumbers: selectedSession.batchNumbers,
        machineCode: selectedSession.machineCode,
        machineType: selectedSession.machineCode,
        operatorId: 0,
        shiftCode: null,
        rerollQuantity: selectedSession.weightMt,
        status: selectedSession.status,
        remarks: selectedSession.remarks,
        startTime: selectedSession.startTime,
        endTime: selectedSession.endTime,
        durationMin: selectedSession.durationMin,
        actualWeightMt: selectedSession.actualWeightMt,
        passes: selectedSession.passes,
        activeStoppage: selectedSession.activeStoppage,
        stoppages: selectedSession.stoppages,
      };
    }
    return null;
  }, [active, selectedSession]);

  const detailPending = selectedPending
    ?? (picked[0] ?? null);
  const detailSession = selectedSession
    ?? (active ? sessions.find((s) => s.sessionId === active.sessionId) ?? null : null);

  const refresh = useCallback(async () => {
    await Promise.all([mutateQueue(), mutateSummary()]);
  }, [mutateQueue, mutateSummary]);

  const selectPending = (hit: ManualRerollOrderHit) => {
    combineManualRef.current = false;
    setSelectedPending(hit);
    setSelectedSession(null);
    setRemarks('');
    applyCombineSelection(hit, false);
  };

  const selectSession = (card: ManualRerollSessionCard) => {
    setSelectedSession(card);
    setSelectedPending(null);
    setPickedIds(new Set());
    setCompatibleIds(new Set());
    setRemarks(freeRemarks(card.remarks));
    setRunOrders((card.batchNumbers?.length ? card.batchNumbers : (card.batchNumber ? [card.batchNumber] : [])).map((batchNumber) => ({
      batchNumber,
      coilNo: card.coilNo,
      customer: card.customer,
      grade: card.grade,
      widthMm: card.widthMm,
      thkMm: card.thkMm,
      weightMt: card.weightMt,
      slitId: card.slitId,
      rollFinish: card.rollFinish,
    })));
  };

  const toggleCombined = (orderId: string, event: MouseEvent) => {
    event.stopPropagation();
    if (!compatibleIds.has(orderId)) return;
    combineManualRef.current = true;
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) {
        if (next.size <= 1) return prev;
        next.delete(orderId);
      } else {
        next.add(orderId);
      }
      return next;
    });
  };

  const cancelCombinedSelection = () => {
    if (!selectedPending) return;
    combineManualRef.current = true;
    setPickedIds(new Set([selectedPending.orderId]));
  };

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
      notifyProductionChanged();
      void refreshMachineState();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(formatManualRerollConflict(e.body, e.message));
      } else {
        setError(e instanceof Error ? e.message : 'Action failed');
      }
    } finally {
      setBusy(false);
    }
  }, [refresh, refreshMachineState]);

  const openSessionId = panelSession?.sessionId;

  const onPrepare = () => {
    if (!selectedPending) return;
    let startOrders = picked.length > 0 ? picked : [];
    if (startOrders.length === 0) {
      startOrders = pending.filter((hit) => rerollCombineKey(hit) === rerollCombineKey(selectedPending));
    }
    if (startOrders.length === 0) startOrders = [selectedPending];
    const primary = startOrders.some((hit) => hit.orderId === selectedPending.orderId)
      ? selectedPending
      : startOrders[0];
    void run(async () => {
      const session = await prepareManualReroll({
        machine: machineCode,
        batchNumber: primary.batchNumber,
        orderId: primary.orderId,
        batchNumbers: startOrders.map((hit) => hit.batchNumber),
        remarks: remarks.trim() || undefined,
      });
      setRunOrders(startOrders.map((hit) => ({
        batchNumber: hit.batchNumber,
        coilNo: hit.coilNo,
        customer: hit.customer,
        grade: hit.grade,
        widthMm: hit.widthMm,
        thkMm: hit.thkMm,
        weightMt: hit.weightMt,
        slitId: hit.slitId,
        rollFinish: hit.rollFinish,
      })));
      setRemarks('');
      setSelectedPending(null);
      setPickedIds(new Set());
      setCompatibleIds(new Set());
      combineManualRef.current = false;
      setSelectedSession({
        kind: 'session',
        sessionId: session.sessionId,
        orderId: session.orderId,
        batchNumber: session.batchNumber,
        batchNumbers: session.batchNumbers ?? [],
        status: session.status,
        machineCode: session.machineCode,
        weightMt: session.rerollQuantity,
        actualWeightMt: session.actualWeightMt,
        passes: session.passes,
        remarks: session.remarks,
        startTime: session.startTime,
        endTime: session.endTime,
        durationMin: session.durationMin,
        activeStoppage: session.activeStoppage ?? null,
        stoppages: session.stoppages ?? [],
        thkMm: primary.thkMm,
        coilNo: primary.coilNo,
        customer: primary.customer,
        grade: primary.grade,
        widthMm: primary.widthMm,
        slitId: primary.slitId,
        rollFinish: primary.rollFinish,
      });
      setConsoleOpen(true);
      setStatus('IN_PROGRESS');
    });
  };

  const onStartProduction = () => {
    if (!openSessionId) return;
    void run(async () => {
      await startPreparedManualReroll(openSessionId, machineCode);
      setConsoleOpen(true);
    });
  };

  const consoleLabel = active
    ? (active.batchNumbers?.length ? active.batchNumbers.join(' · ') : active.batchNumber) ?? '—'
    : null;
  const consoleChip = !active
    ? null
    : active.status === 'STOPPAGE' || active.activeStoppage
      ? 'Stopped'
      : active.status === 'ON_HOLD'
        ? 'Held'
        : active.status === 'PREPARING'
          ? 'Preparing'
          : 'Running';
  const consoleTimer = active && active.status !== 'ON_HOLD' && active.status !== 'PREPARING'
    ? formatRerollNetRuntime(rerollNetRuntimeMs(active.startTime, active.stoppages, now))
    : active?.status === 'ON_HOLD'
      ? 'On hold'
      : active?.status === 'PREPARING'
        ? 'Preparing'
        : null;

  const seedThkMm = detailPending?.thkMm
    ?? selectedSession?.thkMm
    ?? null;

  const railSession = panelSession
    && ['PREPARING', 'IN_PROGRESS', 'ON_HOLD', 'STOPPAGE'].includes(panelSession.status)
    ? panelSession
    : (active ?? null);

  const consoleOrders = (() => {
    if (runOrders.length > 0) return runOrders;
    if (picked.length > 0) {
      return picked.map((hit) => ({
        batchNumber: hit.batchNumber,
        coilNo: hit.coilNo,
        customer: hit.customer,
        grade: hit.grade,
        widthMm: hit.widthMm,
        thkMm: hit.thkMm,
        weightMt: hit.weightMt,
        slitId: hit.slitId,
        rollFinish: hit.rollFinish,
      }));
    }
    const batches = railSession?.batchNumbers?.length
      ? railSession.batchNumbers
      : (railSession?.batchNumber ? [railSession.batchNumber] : []);
    if (batches.length === 0 && detailPending) {
      return [{
        batchNumber: detailPending.batchNumber,
        coilNo: detailPending.coilNo,
        customer: detailPending.customer,
        grade: detailPending.grade,
        widthMm: detailPending.widthMm,
        thkMm: detailPending.thkMm,
        weightMt: detailPending.weightMt,
        slitId: detailPending.slitId,
        rollFinish: detailPending.rollFinish,
      }];
    }
    return batches.map((batchNumber) => {
      const hit = pending.find((p) => p.batchNumber === batchNumber);
      if (hit) {
        return {
          batchNumber: hit.batchNumber,
          coilNo: hit.coilNo,
          customer: hit.customer,
          grade: hit.grade,
          widthMm: hit.widthMm,
          thkMm: hit.thkMm,
          weightMt: hit.weightMt,
          slitId: hit.slitId,
          rollFinish: hit.rollFinish,
        };
      }
      return {
        batchNumber,
        coilNo: selectedSession?.coilNo ?? detailPending?.coilNo,
        customer: selectedSession?.customer ?? detailPending?.customer,
        grade: selectedSession?.grade ?? detailPending?.grade,
        widthMm: selectedSession?.widthMm ?? detailPending?.widthMm,
        thkMm: selectedSession?.thkMm ?? detailPending?.thkMm ?? seedThkMm,
        weightMt: selectedSession?.weightMt ?? detailPending?.weightMt,
        slitId: selectedSession?.slitId ?? detailPending?.slitId,
        rollFinish: selectedSession?.rollFinish ?? detailPending?.rollFinish,
      };
    });
  })();

  const consoleContext = {
    coilNo: consoleOrders[0]?.coilNo ?? detailPending?.coilNo ?? selectedSession?.coilNo,
    customer: consoleOrders[0]?.customer ?? detailPending?.customer ?? selectedSession?.customer,
    grade: consoleOrders[0]?.grade ?? detailPending?.grade ?? selectedSession?.grade,
    widthMm: consoleOrders[0]?.widthMm ?? detailPending?.widthMm ?? selectedSession?.widthMm,
    thkMm: seedThkMm ?? consoleOrders[0]?.thkMm,
    inputThkMm: seedThkMm ?? consoleOrders[0]?.thkMm,
    weightMt: consoleOrders.length > 1
      ? consoleOrders.reduce((sum, o) => sum + (o.weightMt ?? 0), 0)
      : (consoleOrders[0]?.weightMt ?? detailPending?.weightMt ?? selectedSession?.weightMt ?? null),
    slitId: consoleOrders[0]?.slitId ?? detailPending?.slitId ?? selectedSession?.slitId,
    rollFinish: consoleOrders[0]?.rollFinish ?? detailPending?.rollFinish ?? selectedSession?.rollFinish,
    combinedCount: consoleOrders.length > 1 ? consoleOrders.length : undefined,
    combinedTargetMt: consoleOrders.length > 1
      ? consoleOrders.reduce((sum, o) => sum + (o.weightMt ?? 0), 0)
      : undefined,
    orders: consoleOrders,
  };

  const actionRail = (
    <ManualRerollActionRail
      session={railSession}
      pendingLabel={selectedPending?.batchNumber}
      pendingCount={picked.length}
      pendingWeightMt={picked.length > 1 ? pickedWeightMt : (selectedPending?.weightMt ?? null)}
      canPrepare={canWrite && !active && !!selectedPending}
      canStart={canWrite && railSession?.status === 'PREPARING'}
      busy={busy}
      canWrite={canWrite}
      onPrepare={onPrepare}
      onStart={onStartProduction}
      onEnd={() => openSessionId && void run(() => endManualReroll(openSessionId, machineCode))}
      onHold={() => setHoldOpen(true)}
      onRemark={() => {
        if (!openSessionId) return;
        const text = window.prompt('Re-roll remark', freeRemarks(panelSession?.remarks));
        if (text == null) return;
        void run(() => remarkManualReroll(openSessionId, machineCode, text));
      }}
      onStoppage={() => setStoppageOpen(true)}
      onOpenConsole={() => setConsoleOpen(true)}
    />
  );

  return (
    <div className="flex flex-1 min-h-0 bg-secondary overflow-hidden">
      <div className="flex flex-col flex-1 min-h-0 p-4 md:p-5 gap-3 overflow-hidden">
        <ZPageHeader
          title="Manual Re-Roll"
          subtitle={`${machineCode} · overlay (does not change planned production)`}
          actions={<SixHiPillTabs tabs={tabs} activeId="reroll" onChange={setTab} />}
        />

        <div className="shrink-0 flex flex-wrap gap-3 items-stretch">
          <div className="rounded-xl border border-border bg-card px-4 py-3 min-w-[10rem]">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Today re-roll</p>
            <p className="font-mono text-2xl font-bold mt-0.5">{formatRerollSummaryCard(summary).total}</p>
            <p className="text-xs text-muted-foreground">{formatRerollSummaryCard(summary).detail}</p>
          </div>
          {active && (
            <div className="flex-1 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-warning">Active re-roll</p>
                <p className="font-mono font-semibold mt-0.5">{consoleLabel}</p>
                <p className="text-sm text-muted-foreground">
                  {consoleChip} · {consoleTimer}
                </p>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="shrink-0 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="flex gap-2 shrink-0 flex-wrap items-center">
          <div className="relative flex-1 min-w-[12rem]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <ZInput
              className="pl-9"
              placeholder="Search batch / coil / customer"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {showCombine && picked.length > 1 && !active && (
            <ZButton variant="secondary" disabled={busy} onClick={cancelCombinedSelection}>
              Cancel Combined Order
            </ZButton>
          )}
          <ZButton variant="secondary" disabled={busy} onClick={() => void refresh()}>Refresh</ZButton>
        </div>

        <ZFilterPills
          options={MANUAL_REROLL_STATUS_FILTERS.map((f) => ({
            id: f.id,
            label: f.label,
            count: counts[f.id] ?? 0,
          }))}
          activeId={statusFilter}
          onChange={setStatus}
        />

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] gap-3 overflow-hidden">
          <div className="min-h-0 rounded-xl border border-border bg-card overflow-auto">
            {filteredRows.length === 0 && (
              <p className="px-4 py-10 text-sm text-muted-foreground text-center">No items in this filter</p>
            )}
            <ul className="divide-y divide-border">
              {filteredRows.map((row) => {
                if (row.kind === 'pending') {
                  const hit = row.data;
                  const selected = selectedPending?.orderId === hit.orderId || pickedIds.has(hit.orderId);
                  return (
                    <li key={`p-${hit.orderId}`}>
                      <button
                        type="button"
                        className={[
                          'w-full text-left px-3 py-3 hover:bg-secondary flex items-start gap-2',
                          selected ? 'bg-secondary' : '',
                        ].join(' ')}
                        onClick={() => selectPending(hit)}
                      >
                        {showCombine && compatibleIds.has(hit.orderId) && (
                          <input
                            type="checkbox"
                            className="mt-1 h-4 w-4 shrink-0 accent-primary"
                            checked={pickedIds.has(hit.orderId)}
                            aria-label={`Include ${hit.batchNumber} in combined re-roll`}
                            onClick={(e) => toggleCombined(hit.orderId, e)}
                            onChange={() => undefined}
                          />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="font-mono text-sm font-semibold block">
                            {hit.batchNumber}
                            {showCombine && pickedIds.has(hit.orderId) && pickedIds.size > 1 ? (
                              <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-success">Combined</span>
                            ) : null}
                          </span>
                          <span className="text-xs text-muted-foreground block">
                            {hit.coilNo} · {hit.customer} · {hit.status || 'Pending'}
                            {hit.weightMt != null ? ` · ${hit.weightMt} MT` : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                }
                const card = row.data;
                const selected = selectedSession?.sessionId === card.sessionId
                  || active?.sessionId === card.sessionId;
                return (
                  <li key={`s-${card.sessionId}`}>
                    <button
                      type="button"
                      className={[
                        'w-full text-left px-3 py-3 hover:bg-secondary',
                        selected ? 'bg-secondary' : '',
                      ].join(' ')}
                      onClick={() => selectSession(card)}
                    >
                      <span className="font-mono text-sm font-semibold block">
                        {(card.batchNumbers?.length ? card.batchNumbers.join(' · ') : card.batchNumber) ?? '—'}
                      </span>
                      <span className="text-xs text-muted-foreground block">
                        {card.batchNumbers?.length > 1 ? 'Combined · ' : ''}
                        {formatOrderStatusLabel(card.status)}
                        {card.weightMt != null ? ` · ${card.weightMt} MT` : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="min-h-0 rounded-xl border border-border bg-card p-4 flex flex-col gap-3 overflow-auto">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Plan / detail</p>
            {detailPending && !detailSession && (
              <>
                <DetailLine label="Batch" value={detailPending.batchNumber} mono />
                <DetailLine label="Coil" value={detailPending.coilNo} mono />
                <DetailLine label="Customer" value={detailPending.customer} />
                <DetailLine label="Grade" value={detailPending.grade ?? '—'} />
                <DetailLine label="Weight" value={detailPending.weightMt != null ? `${detailPending.weightMt} MT` : '—'} />
                <DetailLine label="Thk" value={detailPending.thkMm != null ? `${detailPending.thkMm} mm` : '—'} />
                <DetailLine label="Width" value={detailPending.widthMm != null ? `${detailPending.widthMm} mm` : '—'} />
                <DetailLine label="Slit / finish" value={`${detailPending.slitId ?? '—'} / ${detailPending.rollFinish ?? '—'}`} />
                {canWrite && !active && (
                  <>
                    <label className="text-sm block mt-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Remarks</span>
                      <ZInput value={remarks} onChange={(e) => setRemarks(e.target.value)} />
                    </label>
                    <ZButton className="w-full mt-2" disabled={busy} onClick={onPrepare}>
                      {picked.length > 1 ? 'Move Combined to Preparing' : 'Move to Preparing'}
                    </ZButton>
                  </>
                )}
                {picked.length > 1 && (
                  <p className="text-xs text-success font-semibold">
                    {picked.length} orders combined · Σ {pickedWeightMt.toFixed(2)} MT
                  </p>
                )}
              </>
            )}
            {detailSession && (
              <>
                <DetailLine
                  label="Batch"
                  value={(detailSession.batchNumbers?.length
                    ? detailSession.batchNumbers.join(' · ')
                    : detailSession.batchNumber) ?? '—'}
                  mono
                />
                <DetailLine label="Status" value={formatOrderStatusLabel(detailSession.status)} />
                <DetailLine label="Weight" value={detailSession.weightMt != null ? `${detailSession.weightMt} MT` : '—'} />
                <DetailLine label="Started" value={new Date(detailSession.startTime).toLocaleString()} />
                {detailSession.durationMin != null && (
                  <DetailLine label="Net min" value={String(detailSession.durationMin)} />
                )}
                <DetailLine label="Remarks" value={freeRemarks(detailSession.remarks) || '—'} />
                {canWrite && detailSession.status === 'PREPARING' && (
                  <div className="mt-auto pt-3 space-y-2">
                    <ZButton className="w-full" disabled={busy} onClick={() => setConsoleOpen(true)}>
                      Open Production Console
                    </ZButton>
                    <ZButton
                      variant="secondary"
                      className="w-full"
                      disabled={busy}
                      onClick={() => void run(async () => {
                        await cancelManualReroll(detailSession.sessionId, machineCode, 'Cancelled prepare');
                        setSelectedSession(null);
                        setConsoleOpen(false);
                        setStatus('PENDING');
                      })}
                    >
                      Cancel Prepare
                    </ZButton>
                  </div>
                )}
                {canWrite && (detailSession.status === 'IN_PROGRESS' || detailSession.status === 'STOPPAGE') && (
                  <div className="mt-auto pt-3">
                    <ZButton className="w-full" disabled={busy} onClick={() => setConsoleOpen(true)}>
                      Open Production Console
                    </ZButton>
                  </div>
                )}
                {canWrite && detailSession.status === 'ON_HOLD' && (
                  <div className="mt-auto pt-3 space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Move to Pending closes this hold session so you can start the order again from the Pending queue.
                    </p>
                    <ZButton
                      className="w-full"
                      disabled={busy}
                      onClick={() => void run(async () => {
                        await releaseManualRerollToPending(detailSession.sessionId, machineCode);
                        setSelectedSession(null);
                        setStatus('PENDING');
                      })}
                    >
                      Move to Pending
                    </ZButton>
                  </div>
                )}
              </>
            )}
            {!detailPending && !detailSession && (
              <p className="text-sm text-muted-foreground">Select a pending order or session</p>
            )}
            {!canWrite && (
              <p className="text-xs text-muted-foreground mt-auto">Read-only. Operators start and finish re-roll.</p>
            )}
          </div>
        </div>
      </div>

      {!consoleOpen && actionRail}

      <ManualRerollWorkspaceModal
        open={consoleOpen}
        session={railSession}
        machine={machineCode}
        context={consoleContext}
        actionRail={actionRail}
        onClose={() => setConsoleOpen(false)}
        onSaved={async () => {
          await refresh();
        }}
      />

      <ManualRerollHoldModal
        open={holdOpen}
        batchLabel={consoleLabel ?? panelSession?.batchNumber ?? 'Re-roll'}
        busy={busy}
        onClose={() => setHoldOpen(false)}
        onSubmit={async (holdRemarks) => {
          if (!openSessionId) throw new Error('No active session');
          await holdManualReroll(openSessionId, machineCode, holdRemarks);
          await refresh();
          notifyProductionChanged();
          void refreshMachineState();
          setStatus('ON_HOLD');
        }}
      />

      {active && (
        <OrderStoppageModal
          open={stoppageOpen}
          hasActiveStoppage={!!active.activeStoppage}
          activeStoppage={active.activeStoppage ? {
            id: active.activeStoppage.stoppageId,
            categoryCode: active.activeStoppage.categoryCode,
            categoryLabel: active.activeStoppage.categoryCode,
            breakdownCode: active.activeStoppage.stoppageCode ?? undefined,
            remarks: active.activeStoppage.remarks ?? undefined,
            startAt: active.activeStoppage.startTime,
            endAt: active.activeStoppage.endTime ?? undefined,
            durationMin: active.activeStoppage.durationMin ?? undefined,
          } : undefined}
          title="Re-roll stoppage"
          subtitle={consoleLabel ?? undefined}
          onClose={() => setStoppageOpen(false)}
          onStart={async (categoryCode, breakdownCode, stopRemarks) => {
            await startManualRerollStoppage({
              sessionId: active.sessionId,
              machine: machineCode,
              categoryCode,
              stoppageCode: breakdownCode,
              remarks: stopRemarks,
            });
            await refresh();
          }}
          onUpdate={async (stoppageId, categoryCode, breakdownCode, stopRemarks) => {
            await updateManualRerollStoppage({
              sessionId: active.sessionId,
              stoppageId,
              machine: machineCode,
              categoryCode,
              stoppageCode: breakdownCode,
              remarks: stopRemarks,
            });
            await refresh();
          }}
          onEnd={async (stoppageId, categoryCode, breakdownCode, stopRemarks) => {
            await endManualRerollStoppage({
              sessionId: active.sessionId,
              stoppageId,
              machine: machineCode,
              categoryCode,
              stoppageCode: breakdownCode,
              remarks: stopRemarks,
            });
            setStoppageOpen(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function DetailLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={['text-sm mt-0.5', mono ? 'font-mono font-semibold' : ''].join(' ')}>{value}</p>
    </div>
  );
}
