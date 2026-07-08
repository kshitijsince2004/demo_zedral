import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import {
  hubTabsForMill,
  normalizeMillTab,
} from '../../lib/millConfig';
import { currentPlantDate } from '../../lib/dateFormat';
import { Search, RefreshCw } from 'lucide-react';
import type { SixHiOrderStatus, SixHiQueueCard } from '@m1/shared-validation';
import { SixHiPillTabs } from '../../components/sixHi/SixHiPillTabs';
import { SixHiStatusPill } from '../../components/sixHi/SixHiStatusPill';
import { SixHiBacklogBadge } from '../../components/sixHi/SixHiBacklogBadge';
import { SixHiBatchDetailPanel } from '../../components/sixHi/SixHiBatchDetailPanel';
import { MachineAllocationModal, type CrmMillCode, type MachineAllocationMode } from '../../components/sixHi/MachineAllocationModal';
import { invalidateMachineRegistryCache } from '../../lib/machineRegistry';
import { apiClient, ApiError } from '../../lib/apiClient';
import { useAuthStore } from '../../lib/authStore';
import { useShiftStore } from '../../store/shiftStore';
import { useSixHiStore } from '../../store/sixHiStore';
import { ZInput } from '../../components/primitives/ZInput';
import { ZPageHeader } from '../../components/ui/operator/ZPageHeader';
import { ZFilterPills } from '../../components/ui/operator/ZFilterPills';
import {
  finishOf,
  isCompatibleCombinedRunOrder,
  primaryOrderId,
  selectIdOf,
} from '../../lib/sixHiOrderIdentity';

type StatusFilter = 'ALL' | SixHiOrderStatus;

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'PREPARING', label: 'Preparing' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'REJECTED', label: 'Rejected' },
];

function matchesFilter(card: SixHiQueueCard, filter: StatusFilter): boolean {
  if (filter === 'ALL') return card.status !== 'REJECTED';
  return card.status === filter;
}

function matchesSearch(card: SixHiQueueCard, q: string): boolean {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  return (
    card.batchNumber.toLowerCase().includes(needle) ||
    card.motherCoil.toLowerCase().includes(needle) ||
    (card.slitId?.toLowerCase().includes(needle) ?? false) ||
    card.customer.toLowerCase().includes(needle)
  );
}

export function SixHiHub() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { shiftCode } = useShiftStore();
  const { openWorkspace, machineActive, setProcessTab, queueRefreshToken, setMachineCode } = useSixHiStore();
  const { machineCode: pathMachine } = useWorkspaceBase();
  const logout = useAuthStore((s) => s.logout);

  const activeTab = normalizeMillTab(pathMachine, searchParams.get('tab'));
  const tabs = hubTabsForMill(pathMachine);
  const statusFilter = (searchParams.get('status')?.toUpperCase() as StatusFilter) || 'ALL';
  const apiSubProcess = activeTab === 'rolling' ? 'ROLLING' : 'SKIN_PASS';
  const subProcessLabel = activeTab === 'rolling' ? 'Rolling' : 'Skin Pass';

  const [queue, setQueue] = useState<SixHiQueueCard[]>([]);
  const [pendingQueue, setPendingQueue] = useState<SixHiQueueCard[]>([]);
  const [backlogQueue, setBacklogQueue] = useState<SixHiQueueCard[]>([]);
  const [viewDate, setViewDate] = useState(currentPlantDate());
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [allocOpen, setAllocOpen] = useState(false);
  const [allocMode, setAllocMode] = useState<MachineAllocationMode>('production');
  const [allocBatches, setAllocBatches] = useState<SixHiQueueCard[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  // Refs for silent background refresh
  const isFirstLoad = useRef(true);
  const prevDataRef = useRef<string>('');
  
  const [isTransferMode, setIsTransferMode] = useState(false);
  const [selectedForTransfer, setSelectedForTransfer] = useState<Set<string>>(new Set());
  const [isCombineMode, setIsCombineMode] = useState(false);
  const [selectedForProduction, setSelectedForProduction] = useState<Set<string>>(new Set());

  const date = viewDate;
  const shift = shiftCode || 'A';
  const queueMachine = pathMachine;
  const userRoles = useAuthStore((s) => s.user?.roles || []);
  const canTransfer = userRoles.includes('ADMIN') || userRoles.includes('MACHINE_HEAD');

  useEffect(() => {
    setMachineCode(pathMachine);
  }, [pathMachine, setMachineCode]);

  useEffect(() => {
    const normalized = normalizeMillTab(pathMachine, searchParams.get('tab'));
    if (searchParams.get('tab') !== normalized) {
      setSearchParams({ tab: normalized, status: statusFilter }, { replace: true });
      return;
    }
    setProcessTab(normalized);
  }, [pathMachine, searchParams, statusFilter, setSearchParams, setProcessTab, activeTab]);

  useEffect(() => {
    void useSixHiStore.getState().refreshMachineState();
  }, [pathMachine]);

  const loadQueue = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setQueueError(null);
    } else {
      setSyncing(true);
    }
    try {
      const res = await apiClient.get(
        `/6hi/queue?subProcess=${apiSubProcess}&date=${date}&shift=${shift}&machine=${queueMachine}`,
      );
      const items: SixHiQueueCard[] = Array.isArray(res) ? res : (res.queue ?? []);
      const pending: SixHiQueueCard[] = Array.isArray(res) ? [] : (res.pendingAllocation ?? []);
      const backlog: SixHiQueueCard[] = Array.isArray(res) ? [] : (res.backlog ?? []);

      // Only update state if data has actually changed — prevents needless re-renders
      const fingerprint = JSON.stringify({ items, pending, backlog });
      if (!silent || fingerprint !== prevDataRef.current) {
        prevDataRef.current = fingerprint;
        setQueue(items);
        setPendingQueue(pending);
        setBacklogQueue(backlog);
      }

      if (!silent) isFirstLoad.current = false;
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate('/login', { replace: true });
        return;
      }
      // Only surface errors on the initial load to avoid toast-spam during background syncs
      if (!silent) {
        if (err instanceof ApiError) {
          setQueueError(err.message || `Queue unavailable (${err.status})`);
        } else {
          setQueueError(err instanceof Error ? err.message : 'Failed to load queue');
        }
        setQueue([]);
        setPendingQueue([]);
        setBacklogQueue([]);
      }
    } finally {
      if (!silent) setLoading(false);
      setSyncing(false);
    }
  }, [apiSubProcess, date, shift, queueMachine, logout, navigate]);

  useEffect(() => {
    // Reset first-load flag whenever dependencies change (tab, date, shift, machine)
    isFirstLoad.current = true;
    prevDataRef.current = '';
    loadQueue(false);
    const id = setInterval(() => void loadQueue(true), 15_000);
    return () => clearInterval(id);
  }, [loadQueue, queueRefreshToken]);

  const allOrders = useMemo(
    () => [...backlogQueue, ...pendingQueue, ...queue],
    [backlogQueue, pendingQueue, queue],
  );

  useEffect(() => {
    const filtered = statusFilter === 'ALL' ? allOrders : allOrders.filter((c) => matchesFilter(c, statusFilter));
    if (filtered.length > 0 && !selectedBatch) {
      setSelectedBatch(filtered[0].batchNumber);
    } else if (filtered.length > 0 && !filtered.find((c) => c.batchNumber === selectedBatch)) {
      setSelectedBatch(filtered[0].batchNumber);
    } else if (filtered.length === 0) {
      setSelectedBatch(null);
    }
  }, [allOrders, statusFilter, selectedBatch]);

  const setTab = (id: string) => {
    setSearchParams({ tab: id, status: statusFilter });
    setSelectedBatch(null);
  };

  const setStatus = (id: StatusFilter) => {
    setSearchParams({ tab: activeTab, status: id });
    setSelectedBatch(null);
  };

  const filteredQueue = useMemo(
    () => allOrders.filter((c) => matchesFilter(c, statusFilter) && matchesSearch(c, search)),
    [allOrders, statusFilter, search],
  );

  const filteredBacklog = useMemo(
    () => backlogQueue.filter((c) => matchesFilter(c, statusFilter) && matchesSearch(c, search)),
    [backlogQueue, statusFilter, search],
  );

  const filteredPending = useMemo(
    () => pendingQueue.filter((c) => matchesFilter(c, statusFilter) && matchesSearch(c, search)),
    [pendingQueue, statusFilter, search],
  );

  const filteredAssigned = useMemo(
    () => queue.filter((c) => matchesFilter(c, statusFilter) && matchesSearch(c, search)),
    [queue, statusFilter, search],
  );

  const selected = filteredQueue.find((c) => c.batchNumber === selectedBatch)
    ?? allOrders.find((c) => c.batchNumber === selectedBatch)
    ?? null;

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      ALL: allOrders.length,
      PENDING: 0,
      PREPARING: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
    };
    for (const card of allOrders) {
      c[card.status] = (c[card.status] ?? 0) + 1;
    }
    return c;
  }, [allOrders]);

  const needsMachineSelection = (card: SixHiQueueCard) =>
    card.machineAllocated === false || !card.machineCode || card.machineCode !== queueMachine;

  const isStartable = (card: SixHiQueueCard) =>
    card.status === 'PENDING' || card.status === 'PREPARING';

  const selectedProductionOrders = useMemo(
    () => allOrders.filter((card) => selectedForProduction.has(card.batchNumber)),
    [allOrders, selectedForProduction],
  );

  const canSelectForCombinedRun = (card: SixHiQueueCard) => {
    if (!isStartable(card)) return false;
    const base = selectedProductionOrders[0];
    return !base || isCompatibleCombinedRunOrder(base, card);
  };

  const startCombinedProduction = async (cards: SixHiQueueCard[]) => {
    if (cards.length === 0) return;
    if (cards.length === 1) {
      moveToProduction(cards[0]);
      return;
    }
    if (cards.some(needsMachineSelection)) {
      setAllocMode('production');
      setAllocBatches(cards);
      setAllocOpen(true);
      return;
    }

    const batchNumbers = cards.map((card) => card.batchNumber);
    const response = await apiClient.post<{ orders: unknown[] }>('/6hi/orders/start-combined', { batchNumbers });
    const firstBatch = cards[0].batchNumber;
    useSixHiStore.getState().setCombinedRun({
      primaryBatchNumber: firstBatch,
      batchNumbers,
      orders: cards.map((card) => ({
        batchNumber: card.batchNumber,
        motherCoil: card.motherCoil,
        slitId: card.slitId,
        customer: card.customer,
        weightMt: card.weightMt,
      })),
    });
    setIsCombineMode(false);
    setSelectedForProduction(new Set());
    useSixHiStore.getState().requestQueueRefresh();
    await loadQueue();
    if (response.orders.length > 0) {
      openWorkspace(firstBatch);
    }
  };

  const moveToProduction = (card: SixHiQueueCard) => {
    if (card.status === 'COMPLETED') return;
    if (needsMachineSelection(card)) {
      setAllocMode('production');
      setAllocBatches([card]);
      setAllocOpen(true);
      return;
    }
    openWorkspace(card.batchNumber);
  };

  const moveToMachine = (card: SixHiQueueCard) => {
    if (card.status === 'COMPLETED' || card.machineAllocated === false) return;
    setAllocMode('transfer');
    setAllocBatches([card]);
    setAllocOpen(true);
  };

  const handleAllocate = async (machineCode: CrmMillCode) => {
    if (allocBatches.length === 0) return;

    if (allocMode === 'production') {
      for (const batch of allocBatches) {
        await apiClient.post(
          `/6hi/orders/${encodeURIComponent(batch.batchNumber)}/allocate-machine`,
          { machineCode },
        );
      }
      invalidateMachineRegistryCache();
      const targetBatch = allocBatches[0]?.batchNumber;
      setAllocOpen(false);
      setAllocBatches([]);
      useSixHiStore.getState().requestQueueRefresh();
      await loadQueue();
      if (allocBatches.length > 1 && machineCode === queueMachine) {
        await startCombinedProduction(allocBatches.map((batch) => ({
          ...batch,
          machineCode,
          machineAllocated: true,
        })));
      } else if (targetBatch && machineCode === queueMachine) {
        openWorkspace(targetBatch);
      }
      return;
    }

    await apiClient.post(
      '/6hi/orders/transfer-machines',
      { machineCode, batchNumbers: allocBatches.map((b) => b.batchNumber) },
    );
    invalidateMachineRegistryCache();
    setAllocOpen(false);
    setIsTransferMode(false);
    setSelectedForTransfer(new Set());
    useSixHiStore.getState().requestQueueRefresh();
    setAllocBatches([]);
    await loadQueue();
  };

  const renderQueueRow = (card: SixHiQueueCard, opts?: { pending?: boolean; backlog?: boolean }) => {
    const isSelected = isTransferMode
      ? selectedForTransfer.has(card.batchNumber)
      : isCombineMode
        ? selectedForProduction.has(card.batchNumber)
      : card.batchNumber === selectedBatch;
    const isActive = machineActive?.batchNumber === card.batchNumber;
    const routeCode = card.subProcess === 'ROLLING' ? '4' : 'X';
    const combineEligible = canSelectForCombinedRun(card);

    return (
      <button
        key={card.batchNumber}
        type="button"
        onClick={() => {
          if (isTransferMode) {
            const next = new Set(selectedForTransfer);
            if (next.has(card.batchNumber)) next.delete(card.batchNumber);
            else next.add(card.batchNumber);
            setSelectedForTransfer(next);
          } else if (isCombineMode) {
            if (!combineEligible && !selectedForProduction.has(card.batchNumber)) return;
            const next = new Set(selectedForProduction);
            if (next.has(card.batchNumber)) next.delete(card.batchNumber);
            else next.add(card.batchNumber);
            setSelectedForProduction(next);
          } else {
            setSelectedBatch(card.batchNumber);
          }
        }}
        className={[
          'w-full text-left border-b border-border px-5 py-4 transition-colors min-h-[88px]',
          'hover:bg-secondary active:bg-secondary',
          isSelected && !isTransferMode ? 'bg-accent/10 border-l-4 border-l-primary' : 'border-l-4 border-l-transparent',
          isSelected && isTransferMode ? 'bg-primary/5 border-l-4 border-l-primary' : '',
          isCombineMode && !combineEligible && !isSelected ? 'opacity-45' : '',
          isSelected && isCombineMode ? 'bg-success/10 border-l-4 border-l-success' : '',
          isActive ? 'ring-1 ring-inset ring-warning/30' : '',
          opts?.pending ? 'bg-secondary/40' : '',
          card.isBacklog ? 'bg-destructive/5' : '',
        ].join(' ')}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="min-w-0">
            <span className="font-mono text-lg font-bold text-foreground block truncate">{primaryOrderId(card)}</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Select ID {selectIdOf(card)} · Batch {card.batchNumber}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {card.isBacklog && <SixHiBacklogBadge planDate={card.planDate} />}
            {isCombineMode && (
              <span className={[
                'h-6 w-6 rounded-md border flex items-center justify-center text-xs font-bold',
                isSelected ? 'bg-success text-white border-success' : 'bg-white border-border text-muted-foreground',
              ].join(' ')}>
                {isSelected ? '✓' : ''}
              </span>
            )}
            {opts?.pending && (
              <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-warning/15 text-warning">
                Awaiting mill
              </span>
            )}
            <SixHiStatusPill status={card.status} prepReady={card.prepReady} />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="truncate">{card.customer}</span>
          <span className="font-mono truncate">Finish {finishOf(card)}</span>
          <span className="font-mono">
            {card.inputThkMm}→{card.targetThkMm} mm
            {card.finishThkMm != null && card.finishThkMm !== card.targetThkMm ? ` (fin ${card.finishThkMm})` : ''}
            {card.rollingPassNo && card.rollingPassNo > 1 ? ` · P${card.rollingPassNo}` : ''}
          </span>
          <span className="font-mono">{card.weightMt} MT</span>
          <span className="font-mono text-[10px] uppercase tracking-wide">Route {routeCode}</span>
          <span className="font-semibold text-foreground col-span-1 md:col-span-3">
            {card.machineAllocated === false
              ? `Unassigned${card.suggestedMachineCode ? ` · hint ${card.suggestedMachineCode}` : ''}`
              : `Mill ${card.machineCode}`}
          </span>
        </div>
      </button>
    );
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-secondary p-4 md:p-5 gap-3 overflow-hidden">
      <ZPageHeader
        title="Orders"
        actions={
          <div className="flex gap-2 items-center flex-wrap justify-end">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Date
              <input
                type="date"
                value={viewDate}
                onChange={(e) => {
                  setViewDate(e.target.value || currentPlantDate());
                  setSelectedBatch(null);
                }}
                className="min-h-9 rounded-md border border-border bg-white px-3 text-sm font-mono text-foreground normal-case tracking-normal"
              />
            </label>
            {canTransfer && (
              <button
                type="button"
                onClick={() => {
                  setIsTransferMode(!isTransferMode);
                  setSelectedForTransfer(new Set());
                  setIsCombineMode(false);
                  setSelectedForProduction(new Set());
                }}
                className={[
                  "text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-md border transition-colors",
                  isTransferMode ? "bg-primary text-primary-foreground border-primary" : "bg-white text-muted-foreground border-border hover:bg-secondary"
                ].join(' ')}
              >
                {isTransferMode ? 'Cancel Transfer' : 'Bulk Transfer'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setIsCombineMode(!isCombineMode);
                setSelectedForProduction(new Set());
                setIsTransferMode(false);
                setSelectedForTransfer(new Set());
              }}
              className={[
                "text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-md border transition-colors",
                isCombineMode ? "bg-success text-white border-success" : "bg-white text-muted-foreground border-border hover:bg-secondary"
              ].join(' ')}
            >
              {isCombineMode ? 'Cancel Combined' : 'Combined Run'}
            </button>
            <button
              type="button"
              onClick={() => {
                useSixHiStore.getState().requestQueueRefresh();
              }}
              title="Refresh Queue"
              className="min-h-9 px-3 rounded-md border border-border bg-white text-muted-foreground hover:bg-secondary flex items-center justify-center transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin text-primary' : ''}`} />
            </button>
            <SixHiPillTabs tabs={tabs} activeId={activeTab} onChange={setTab} />
          </div>
        }
      />

      {queueError && (
        <div className="shrink-0 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {queueError}
        </div>
      )}

      <div className="shrink-0 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" aria-hidden />
          <ZInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search mother coil, Select ID, customer, batch…"
            className="min-h-14 pl-12 text-base"
          />
        </div>
        <ZFilterPills
          options={STATUS_FILTERS.map((f) => ({ id: f.id, label: f.label, count: counts[f.id] ?? 0 }))}
          activeId={statusFilter}
          onChange={setStatus}
        />
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 overflow-hidden">
        <div className="flex-1 min-w-0 min-h-0 bg-white border border-border rounded-2xl shadow-sm flex flex-col overflow-hidden order-2 lg:order-1">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {subProcessLabel} Queue · {filteredQueue.length} orders
            </h2>
            {machineActive && (
              <span className="text-xs font-semibold text-warning">
                Active: {machineActive.batchNumber}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-auto">
            {/* Show spinner only on first/empty load — never during background refreshes */}
            {loading && <p className="text-center text-muted-foreground py-12 text-base">Loading queue…</p>}
            {!loading && filteredQueue.length === 0 && (
              <div className="text-center py-12 px-6">
                <p className="text-muted-foreground text-base mb-2">No orders match this filter</p>
              </div>
            )}
            {!loading && filteredBacklog.length > 0 && (
              <>
                <div className="px-5 py-2 bg-destructive/10 border-b border-destructive/20">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">
                    Backlog · {filteredBacklog.length}
                  </p>
                </div>
                {filteredBacklog.map((card) => renderQueueRow(card, { backlog: true }))}
              </>
            )}
            {!loading && filteredPending.length > 0 && (
              <>
                <div className="px-5 py-2 bg-secondary/60 border-b border-border">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Awaiting machine · {filteredPending.length}
                  </p>
                </div>
                {filteredPending.map((card) => renderQueueRow(card, { pending: true }))}
              </>
            )}
            {!loading && filteredAssigned.length > 0 && filteredPending.length > 0 && (
              <div className="px-5 py-2 bg-muted/30 border-b border-border">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {queueMachine} queue · {filteredAssigned.length}
                </p>
              </div>
            )}
            {!loading && filteredAssigned.map((card) => renderQueueRow(card))}
          </div>
        </div>

        <aside className="order-1 lg:order-2 w-full lg:w-[400px] shrink-0 min-h-0 lg:h-full flex flex-col overflow-hidden max-h-[min(480px,45vh)] lg:max-h-none">
          <SixHiBatchDetailPanel
            batch={selected}
            subProcessLabel={subProcessLabel}
            currentMill={queueMachine}
            onOpen={() => selected && moveToProduction(selected)}
            onMoveToMachine={() => selected && moveToMachine(selected)}
          />
        </aside>
      </div>

      {isTransferMode && selectedForTransfer.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] bg-foreground text-background rounded-full pl-6 pr-2 py-2 shadow-2xl flex items-center gap-4 animate-in slide-in-from-bottom-8">
          <span className="font-bold text-sm tracking-wide">{selectedForTransfer.size} order{selectedForTransfer.size > 1 ? 's' : ''} selected</span>
          <button
            type="button"
            className="bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold px-4 py-2 rounded-full transition-colors"
            onClick={() => {
              setAllocMode('transfer');
              setAllocBatches(allOrders.filter((c) => selectedForTransfer.has(c.batchNumber)));
              setAllocOpen(true);
            }}
          >
            Transfer…
          </button>
        </div>
      )}

      {isCombineMode && selectedForProduction.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] bg-foreground text-background rounded-full pl-6 pr-2 py-2 shadow-2xl flex items-center gap-4 animate-in slide-in-from-bottom-8">
          <span className="font-bold text-sm tracking-wide">
            {selectedForProduction.size} compatible order{selectedForProduction.size > 1 ? 's' : ''} selected
          </span>
          <button
            type="button"
            className="bg-success hover:bg-success/90 text-white text-sm font-bold px-4 py-2 rounded-full transition-colors disabled:opacity-50"
            disabled={selectedProductionOrders.length < 2}
            onClick={() => {
              void startCombinedProduction(selectedProductionOrders).catch((err) => {
                setQueueError(err instanceof Error ? err.message : 'Failed to start combined production');
              });
            }}
          >
            Start Combined Run
          </button>
        </div>
      )}

      <MachineAllocationModal
        open={allocOpen}
        mode={allocMode}
        batches={allocBatches}
        onClose={() => { setAllocOpen(false); setAllocBatches([]); }}
        onConfirm={handleAllocate}
      />
    </div>
  );
}
