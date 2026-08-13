import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useWorkspaceBase } from '../../../hooks/useWorkspaceBase';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { useManualRerollEntry } from '../../../hooks/useTenantFlag';
import { hubTabsForMill } from '../../../lib/millConfig';
import {
  MANUAL_REROLL_STATUS_FILTERS,
  countRerollFilters,
  formatManualRerollConflict,
  formatRerollNetRuntime,
  formatRerollSummaryCard,
  manualRerollStatusToPill,
  matchesRerollStatusFilter,
  rerollCombineKey,
  rerollHitToQueueCard,
  rerollNetRuntimeMs,
  rerollSessionToQueueCard,
  withManualRerollTab,
  type ManualRerollStatusFilter,
} from '../../../lib/manualRerollUi';
import { ApiError, getServerTime } from '../../../lib/apiClient';
import { subscribeTimerTick } from '../../../hooks/useTimerTick';
import { notifyProductionChanged } from '../../../lib/productionSync';
import { SixHiPillTabs } from '../SixHiPillTabs';
import { SixHiStatusPill } from '../SixHiStatusPill';
import { SixHiQueueRow } from '../SixHiQueueRow';
import { SixHiBatchDetailPanel } from '../SixHiBatchDetailPanel';
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
  type ManualRerollStoppage,
} from '../../../services/manualRerollService';
import { displayMotherCoilId } from '../../../lib/sixHiOrderIdentity';
import { useSixHiStore } from '../../../store/sixHiStore';
import { VirtualizedList } from '../../VirtualizedList';

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
  const debouncedQ = useDebouncedValue(query, 250);

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
  const refreshMachineState = useSixHiStore((s) => s.refreshMachineState);

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

  const selectPending = useCallback((hit: ManualRerollOrderHit) => {
    combineManualRef.current = false;
    setSelectedPending(hit);
    setSelectedSession(null);
    setRemarks('');
    applyCombineSelection(hit, false);
  }, [applyCombineSelection]);

  const selectSession = useCallback((card: ManualRerollSessionCard) => {
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
  }, []);

  const toggleCombined = useCallback((batchNumber: string, event: MouseEvent) => {
    event.stopPropagation();
    const hit = pending.find((p) => p.batchNumber === batchNumber);
    if (!hit || !compatibleIds.has(hit.orderId)) return;
    combineManualRef.current = true;
    setPickedIds((prev) => {
      const next = new Set(prev);
      if (next.has(hit.orderId)) {
        if (next.size <= 1) return prev;
        next.delete(hit.orderId);
      } else {
        next.add(hit.orderId);
      }
      return next;
    });
  }, [compatibleIds, pending]);

  const renderQueueRow = useCallback((row: QueueRow) => {
    if (row.kind === 'pending') {
      const hit = row.data;
      return (
        <SixHiQueueRow
          key={`p-${hit.orderId}`}
          card={rerollHitToQueueCard(hit, machineCode)}
          isSelected={selectedPending?.orderId === hit.orderId || pickedIds.has(hit.orderId)}
          isTransferMode={false}
          isInCombinedSelection={pickedIds.has(hit.orderId)}
          showCombineCheckbox={showCombine && compatibleIds.has(hit.orderId)}
          isActive={false}
          combinedSelectionCount={pickedIds.size}
          onSelect={() => selectPending(hit)}
          onTransferToggle={() => undefined}
          onCombineToggle={toggleCombined}
        />
      );
    }
    const sess = row.data;
    return (
      <SixHiQueueRow
        key={`s-${sess.sessionId}`}
        card={rerollSessionToQueueCard(sess, machineCode)}
        isSelected={selectedSession?.sessionId === sess.sessionId || active?.sessionId === sess.sessionId}
        isTransferMode={false}
        isInCombinedSelection={false}
        showCombineCheckbox={false}
        isActive={active?.sessionId === sess.sessionId}
        combinedSelectionCount={1}
        wasRerolled={sess.status === 'COMPLETED'}
        lastRerolledThicknessMm={sess.thkMm}
        onSelect={() => selectSession(sess)}
        onTransferToggle={() => undefined}
        onCombineToggle={() => undefined}
      />
    );
  }, [
    machineCode,
    selectedPending,
    selectedSession,
    active,
    pickedIds,
    showCombine,
    compatibleIds,
    selectPending,
    selectSession,
    toggleCombined,
  ]);

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
        orderId: primary.orderId !== primary.batchNumber ? primary.orderId : undefined,
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
      setStatus('PREPARING');
    });
  };

  const onStartProduction = () => {
    if (!openSessionId) return;
    void run(async () => {
      await startPreparedManualReroll(openSessionId, machineCode);
      setConsoleOpen(true);
      setStatus('IN_PROGRESS');
    });
  };

  const consoleLabel = active
    ? (active.batchNumbers?.length ? active.batchNumbers.join(' · ') : active.batchNumber) ?? '—'
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
    thkMm: railSession?.targetThkMm ?? seedThkMm ?? consoleOrders[0]?.thkMm,
    inputThkMm: railSession?.inputThkMm ?? null,
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

  const detailCard = detailPending && !detailSession
    ? rerollHitToQueueCard(detailPending, machineCode)
    : detailSession
      ? rerollSessionToQueueCard(detailSession, machineCode)
      : null;

  const detailFooter = (() => {
    if (detailPending && !detailSession) {
      return (
        <>
          {canWrite && !active && (
            <>
              <label className="text-sm block">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Remarks</span>
                <ZInput value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              </label>
              <ZButton className="w-full min-h-14 text-base font-bold" disabled={busy} onClick={onPrepare}>
                {picked.length > 1 ? `Move Combined to Preparing (${picked.length})` : 'Move to Preparing'}
              </ZButton>
            </>
          )}
          {!canWrite && (
            <p className="text-xs text-muted-foreground">Read-only. Operators start and finish re-roll.</p>
          )}
        </>
      );
    }
    if (!detailSession || !canWrite) {
      return !canWrite
        ? <p className="text-xs text-muted-foreground">Read-only. Operators start and finish re-roll.</p>
        : null;
    }
    if (detailSession.status === 'PREPARING') {
      return (
        <div className="space-y-2">
          <ZButton className="w-full min-h-14 text-base font-bold" disabled={busy} onClick={onStartProduction}>
            Start
          </ZButton>
          <ZButton className="w-full" variant="secondary" disabled={busy} onClick={() => setConsoleOpen(true)}>
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
      );
    }
    if (detailSession.status === 'IN_PROGRESS' || detailSession.status === 'STOPPAGE') {
      return (
        <ZButton className="w-full min-h-14 text-base font-bold" disabled={busy} onClick={() => setConsoleOpen(true)}>
          Open Production Console
        </ZButton>
      );
    }
    if (detailSession.status === 'ON_HOLD') {
      return (
        <div className="space-y-2">
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
      );
    }
    return null;
  })();

  const actionRail = (
    <ManualRerollActionRail
      session={railSession}
      pendingLabel={selectedPending ? displayMotherCoilId(selectedPending) : undefined}
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
          actions={
            <div className="flex gap-2 sm:gap-3 items-center flex-wrap justify-end w-full lg:w-auto">
              {showCombine && picked.length > 1 && !active && (
                <button
                  type="button"
                  onClick={cancelCombinedSelection}
                  disabled={busy}
                  className="text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-md border bg-white text-destructive border-destructive/30 hover:bg-destructive/5 transition-colors"
                >
                  Cancel Combined Order
                </button>
              )}
              <SixHiPillTabs tabs={tabs} activeId="reroll" onChange={setTab} />
            </div>
          }
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
                  <ActiveElapsedClock status={active.status} startTime={active.startTime} stoppages={active.stoppages} />
                </p>
              </div>
              {(() => {
                const pill = manualRerollStatusToPill(active.status);
                return <SixHiStatusPill status={pill.status} preparing={pill.preparing} />;
              })()}
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
          {picked.length > 1 && (
            <p className="text-sm font-medium font-mono tabular-nums shrink-0">
              Combined {picked.length} · Σ {pickedWeightMt.toFixed(2)} MT
            </p>
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

        <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 overflow-hidden">
          <div className="flex-1 min-w-0 min-h-0 bg-white border border-border rounded-2xl shadow-sm flex flex-col overflow-hidden order-2 lg:order-1">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Manual Re-Roll Queue · {filteredRows.length} orders
              </h2>
            </div>
            {filteredRows.length === 0 && (
              <p className="px-4 py-10 text-sm text-muted-foreground text-center">No items in this filter</p>
            )}
            {filteredRows.length > 12 ? (
              <VirtualizedList
                items={filteredRows}
                estimateSize={88}
                className="flex-1 min-h-0"
                getKey={(row) => (row.kind === 'pending' ? `p-${row.data.orderId}` : `s-${row.data.sessionId}`)}
                renderItem={(row) => renderQueueRow(row)}
              />
            ) : (
              <div className="flex-1 min-h-0 overflow-auto">
                {filteredRows.map((row) => renderQueueRow(row))}
              </div>
            )}
          </div>

          <aside className="order-1 lg:order-2 w-full lg:w-[400px] shrink-0 min-h-0 lg:h-full flex flex-col overflow-hidden max-h-[min(480px,45vh)] lg:max-h-none">
            <SixHiBatchDetailPanel
              batch={detailCard}
              subProcessLabel="Manual Re-Roll"
              currentMill={machineCode}
              machineActiveBatch={active?.batchNumber ?? null}
              combinedCount={detailPending && !detailSession ? picked.length : (detailSession?.batchNumbers?.length ?? 1)}
              combinedBatchNumbers={
                detailPending && !detailSession
                  ? picked.map((p) => p.batchNumber)
                  : (detailSession?.batchNumbers ?? [])
              }
              wasRerolled={detailSession?.status === 'COMPLETED'}
              lastRerolledThicknessMm={detailSession?.thkMm}
              loadHistory={false}
              onOpen={detailPending && !detailSession ? onPrepare : () => setConsoleOpen(true)}
              footer={detailFooter ?? <></>}
            />
          </aside>
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

/** 1 Hz session clock isolated to its own leaf so the hub doesn't re-render every tick. */
const ActiveElapsedClock = memo(function ActiveElapsedClock({
  status,
  startTime,
  stoppages,
}: {
  status: string;
  startTime: string;
  stoppages?: ManualRerollStoppage[];
}) {
  const [now, setNow] = useState(() => getServerTime());
  useEffect(() => {
    if (status === 'ON_HOLD' || status === 'PREPARING') return;
    return subscribeTimerTick(() => setNow(getServerTime()));
  }, [status]);

  if (status === 'ON_HOLD') return <>On hold</>;
  if (status === 'PREPARING') return <>Preparing</>;
  return <>{formatRerollNetRuntime(rerollNetRuntimeMs(startTime, stoppages, now))}</>;
});
