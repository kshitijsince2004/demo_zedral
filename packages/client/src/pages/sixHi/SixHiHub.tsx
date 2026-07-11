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
  buildCombinedRunFromCards,
  cardsShareProductionAction,
  combinedActionLabel,
  dedupeQueueCards,
  findCompatibleOrdersForCombine,
} from '../../lib/combinedProductionRun';
import {
  displayMotherCoilId,
  finishOf,
  selectIdOf,
} from '../../lib/sixHiOrderIdentity';
import { ORDER_HOLD_STATUS_LABEL } from '../../lib/orderLabels';
import { jsonFingerprint } from '../../lib/silentRefresh';

type StatusFilter = 'ALL' | SixHiOrderStatus;

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'PREPARING', label: 'Preparing' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'REJECTED', label: ORDER_HOLD_STATUS_LABEL },
];

function matchesFilter(card: SixHiQueueCard, filter: StatusFilter): boolean {
  if (filter === 'ALL') return card.status !== 'REJECTED';
  if (filter === 'IN_PROGRESS') return card.status === 'IN_PROGRESS' || card.status === 'STOPPAGE';
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
  const { shiftCode, shiftLogId } = useShiftStore();
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
  const [completedQueue, setCompletedQueue] = useState<SixHiQueueCard[]>([]);
  const [rejectedQueue, setRejectedQueue] = useState<SixHiQueueCard[]>([]);
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
  const [anchorBatch, setAnchorBatch] = useState<string | null>(null);
  const [autoCombinedBatchNumbers, setAutoCombinedBatchNumbers] = useState<Set<string>>(new Set());
  const combinedSelectionManual = useRef(false);

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
    }
    try {
      const params = new URLSearchParams({
        subProcess: apiSubProcess,
        date,
        shift,
        machine: queueMachine,
      });
      if (shiftLogId) params.set('shiftLogId', shiftLogId);
      const res = await apiClient.get(`/6hi/queue?${params.toString()}`);
      const items: SixHiQueueCard[] = Array.isArray(res) ? res : (res.queue ?? []);
      const pending: SixHiQueueCard[] = Array.isArray(res) ? [] : (res.pendingAllocation ?? []);
      const backlog: SixHiQueueCard[] = Array.isArray(res) ? [] : (res.backlog ?? []);
      const completed: SixHiQueueCard[] = Array.isArray(res) ? [] : (res.completed ?? []);
      const rejected: SixHiQueueCard[] = Array.isArray(res) ? [] : (res.rejected ?? []);

      const fingerprint = jsonFingerprint({ items, pending, backlog, completed, rejected });
      if (!silent || fingerprint !== prevDataRef.current) {
        prevDataRef.current = fingerprint;
        setQueue(items);
        setPendingQueue(pending);
        setBacklogQueue(backlog);
        setCompletedQueue(completed);
        setRejectedQueue(rejected);
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
        setCompletedQueue([]);
        setRejectedQueue([]);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [apiSubProcess, date, shift, queueMachine, shiftLogId, logout, navigate]);

  useEffect(() => {
    isFirstLoad.current = true;
    prevDataRef.current = '';
    void loadQueue(false);
    const id = setInterval(() => void loadQueue(true), 15_000);
    return () => clearInterval(id);
  }, [loadQueue]);

  const queueRefreshMountedRef = useRef(false);

  useEffect(() => {
    if (!queueRefreshMountedRef.current) {
      queueRefreshMountedRef.current = true;
      return;
    }
    void loadQueue(true);
  }, [queueRefreshToken, loadQueue]);

  const allOrders = useMemo(
    () => dedupeQueueCards([...backlogQueue, ...pendingQueue, ...queue, ...completedQueue, ...rejectedQueue]),
    [backlogQueue, pendingQueue, queue, completedQueue, rejectedQueue],
  );

  const machineActiveCard = useMemo(
    () => (machineActive ? allOrders.find((c) => c.batchNumber === machineActive.batchNumber) : undefined),
    [allOrders, machineActive],
  );

  const applyCombinedSelection = useCallback((anchor: SixHiQueueCard) => {
    const compatible = findCompatibleOrdersForCombine(anchor, allOrders, queueMachine);
    setAutoCombinedBatchNumbers(new Set(compatible.map((o) => o.batchNumber)));
  }, [allOrders, queueMachine]);

  useEffect(() => {
    setAnchorBatch(null);
    setAutoCombinedBatchNumbers(new Set());
    combinedSelectionManual.current = false;
  }, [apiSubProcess]);

  useEffect(() => {
    const filtered = statusFilter === 'ALL' ? allOrders : allOrders.filter((c) => matchesFilter(c, statusFilter));
    setSelectedBatch((current) => {
      if (current && filtered.some((c) => c.batchNumber === current)) return current;
      return filtered[0]?.batchNumber ?? null;
    });
    setAnchorBatch((current) => {
      if (current && filtered.some((c) => c.batchNumber === current)) return current;
      return filtered[0]?.batchNumber ?? null;
    });
  }, [allOrders, statusFilter, queueMachine]);

  useEffect(() => {
    if (combinedSelectionManual.current) return;
    if (!selectedBatch) {
      setAutoCombinedBatchNumbers(new Set());
      return;
    }
    const card = allOrders.find((c) => c.batchNumber === selectedBatch);
    if (!card) return;
    const compatible = findCompatibleOrdersForCombine(card, allOrders, queueMachine);
    setAutoCombinedBatchNumbers(new Set(compatible.map((o) => o.batchNumber)));
  }, [selectedBatch, allOrders, queueMachine]);

  const setTab = (id: string) => {
    setSearchParams({ tab: id, status: statusFilter });
  };

  const setStatus = (id: StatusFilter) => {
    setSearchParams({ tab: activeTab, status: id });
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

  const filteredCompleted = useMemo(
    () => completedQueue.filter((c) => matchesFilter(c, statusFilter) && matchesSearch(c, search)),
    [completedQueue, statusFilter, search],
  );

  const filteredRejected = useMemo(
    () => rejectedQueue.filter((c) => matchesFilter(c, statusFilter) && matchesSearch(c, search)),
    [rejectedQueue, statusFilter, search],
  );

  const showOperationalSections = statusFilter !== 'COMPLETED' && statusFilter !== 'REJECTED';
  const showCompletedSection = statusFilter === 'ALL' || statusFilter === 'COMPLETED';
  const showRejectedSection = statusFilter === 'REJECTED';
  const visibleOrderCount = (showOperationalSections
    ? filteredBacklog.length + filteredPending.length + filteredAssigned.length
    : 0)
    + (showCompletedSection ? filteredCompleted.length : 0)
    + (showRejectedSection ? filteredRejected.length : 0);

  const isStartable = (card: SixHiQueueCard) =>
    card.status === 'PENDING' || card.status === 'PREPARING';

  const selectOrder = useCallback((card: SixHiQueueCard) => {
    if (card.batchNumber === anchorBatch && combinedSelectionManual.current) {
      setSelectedBatch(card.batchNumber);
      return;
    }
    combinedSelectionManual.current = false;
    setSelectedBatch(card.batchNumber);
    setAnchorBatch(card.batchNumber);
    applyCombinedSelection(card);
  }, [applyCombinedSelection, anchorBatch]);

  useEffect(() => {
    if (!anchorBatch || combinedSelectionManual.current) return;
    const anchor = allOrders.find((c) => c.batchNumber === anchorBatch);
    if (!anchor) return;
    applyCombinedSelection(anchor);
  }, [allOrders, anchorBatch, applyCombinedSelection]);

  const cancelCombinedSelection = () => {
    if (!anchorBatch) return;
    combinedSelectionManual.current = true;
    setAutoCombinedBatchNumbers(new Set([anchorBatch]));
  };

  const sortQueueSection = useCallback(
    (items: SixHiQueueCard[]) => {
      if (!anchorBatch) return items;
      const anchor = allOrders.find((c) => c.batchNumber === anchorBatch);
      if (!anchor) return items;
      return [...items].sort((a, b) => {
        const aSameMother = a.motherCoil === anchor.motherCoil ? 0 : 1;
        const bSameMother = b.motherCoil === anchor.motherCoil ? 0 : 1;
        if (aSameMother !== bSameMother) return aSameMother - bSameMother;
        return a.queuePosition - b.queuePosition;
      });
    },
    [anchorBatch, allOrders],
  );

  const selected = filteredQueue.find((c) => c.batchNumber === selectedBatch)
    ?? allOrders.find((c) => c.batchNumber === selectedBatch)
    ?? null;

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      ALL: allOrders.filter((card) => card.status !== 'REJECTED').length,
      PENDING: 0,
      PREPARING: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
      REJECTED: 0,
    };
    for (const card of allOrders) {
      c[card.status] = (c[card.status] ?? 0) + 1;
    }
    c.IN_PROGRESS = (c.IN_PROGRESS ?? 0) + (c.STOPPAGE ?? 0);
    return c;
  }, [allOrders]);

  const needsMachineSelection = (card: SixHiQueueCard) =>
    card.machineAllocated === false || !card.machineCode || card.machineCode !== queueMachine;

  const selectedProductionOrders = useMemo(
    () => allOrders.filter((card) => autoCombinedBatchNumbers.has(card.batchNumber)),
    [allOrders, autoCombinedBatchNumbers],
  );

  const openCombinedView = (cards: SixHiQueueCard[]) => {
    const primaryBatch = anchorBatch && cards.some((c) => c.batchNumber === anchorBatch)
      ? anchorBatch
      : cards[0].batchNumber;
    const combined = buildCombinedRunFromCards(cards, primaryBatch);
    if (combined) {
      useSixHiStore.getState().setCombinedRun(combined);
    }
    const primaryCard = cards.find((c) => c.batchNumber === primaryBatch) ?? cards[0];
    openProductionForCard(primaryCard);
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
    const primaryBatch = anchorBatch && cards.some((c) => c.batchNumber === anchorBatch)
      ? anchorBatch
      : cards[0].batchNumber;
    const response = await apiClient.post<{ orders: unknown[] }>('/6hi/orders/start-combined', { batchNumbers });
    const combined = buildCombinedRunFromCards(cards, primaryBatch);
    if (combined) {
      useSixHiStore.getState().setCombinedRun(combined);
    }
    setAutoCombinedBatchNumbers(new Set());
    useSixHiStore.getState().requestQueueRefresh();
    await loadQueue();
    if (response.orders.length > 0) {
      openProductionForCard(cards.find((c) => c.batchNumber === primaryBatch) ?? cards[0]);
    }
  };

  const moveSelectedToProduction = () => {
    const cards = selectedProductionOrders;
    if (cards.length > 1 && cardsShareProductionAction(cards)) {
      if (cards.every(isStartable)) {
        void startCombinedProduction(cards).catch((err) => {
          setQueueError(err instanceof Error ? err.message : 'Failed to start combined production');
        });
        return;
      }
      openCombinedView(cards);
      return;
    }
    if (cards.length === 1) moveToProduction(cards[0]);
    else if (selected) moveToProduction(selected);
  };

  const openProductionForCard = (card: SixHiQueueCard) => {
    const tab = card.subProcess === 'ROLLING' ? 'rolling' : 'skinpass';
    if (activeTab !== tab) {
      setSearchParams({ tab, status: statusFilter });
    }
    openWorkspace(card.batchNumber);
  };

  const moveToProduction = (card: SixHiQueueCard) => {
    if (card.status === 'COMPLETED' || card.status === 'REJECTED') {
      const combined = selectedProductionOrders.length > 1
        && cardsShareProductionAction(selectedProductionOrders)
        && selectedProductionOrders.every((c) => c.status === card.status)
        ? selectedProductionOrders
        : [card];
      if (combined.length > 1) {
        openCombinedView(combined);
      } else {
        openProductionForCard(card);
      }
      return;
    }
    if (needsMachineSelection(card)) {
      setAllocMode('production');
      setAllocBatches([card]);
      setAllocOpen(true);
      return;
    }
    openProductionForCard(card);
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
      : card.batchNumber === selectedBatch;
    const isInCombinedSelection = autoCombinedBatchNumbers.has(card.batchNumber);
    const isActive = machineActive?.batchNumber === card.batchNumber;
    const routeCode = card.subProcess === 'ROLLING' ? '4' : 'X';

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
          } else {
            selectOrder(card);
          }
        }}
        className={[
          'w-full text-left border-b border-border px-5 py-4 transition-colors min-h-[88px]',
          'hover:bg-secondary active:bg-secondary',
          isSelected ? 'bg-accent/10 border-l-4 border-l-primary' : 'border-l-4 border-l-transparent',
          isSelected && isTransferMode ? 'bg-primary/5 border-l-4 border-l-primary' : '',
          isInCombinedSelection && selectedProductionOrders.length > 1 ? 'ring-1 ring-inset ring-success/25' : '',
          isActive ? 'ring-1 ring-inset ring-warning/30' : '',
          opts?.pending ? 'bg-secondary/40' : '',
          card.isBacklog ? 'bg-destructive/5' : '',
        ].join(' ')}
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="min-w-0">
            <span className="font-mono text-lg font-bold text-foreground block truncate">{displayMotherCoilId(card)}</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Slit ID {selectIdOf(card)} · Batch {card.batchNumber}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {card.isBacklog && <SixHiBacklogBadge planDate={card.planDate} />}
            {isInCombinedSelection && selectedProductionOrders.length > 1 && (
              <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full bg-success/15 text-success">
                Combined
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
        title="Machine"
        subtitle={`${queueMachine} · ${subProcessLabel}`}
        actions={
          <div className="flex gap-2 sm:gap-3 items-center flex-wrap justify-end w-full lg:w-auto">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Date
              <input
                type="date"
                value={viewDate}
                onChange={(e) => {
                  setViewDate(e.target.value || currentPlantDate());
                  setSelectedBatch(null);
                  setAnchorBatch(null);
                  combinedSelectionManual.current = false;
                  setAutoCombinedBatchNumbers(new Set());
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
                }}
                className={[
                  'text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-md border transition-colors',
                  isTransferMode ? 'bg-primary text-primary-foreground border-primary' : 'bg-white text-muted-foreground border-border hover:bg-secondary',
                ].join(' ')}
              >
                {isTransferMode ? 'Cancel Transfer' : 'Bulk Transfer'}
              </button>
            )}
            {selectedProductionOrders.length > 1 && (
              <button
                type="button"
                onClick={cancelCombinedSelection}
                className="text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-md border bg-white text-destructive border-destructive/30 hover:bg-destructive/5 transition-colors"
              >
                Cancel Combined Order
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSyncing(true);
                void loadQueue(true).finally(() => setSyncing(false));
              }}
              title="Refresh Queue"
              className="min-h-9 px-3 rounded-md border border-border bg-white text-muted-foreground hover:bg-secondary flex items-center justify-center transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin text-primary' : ''}`} />
            </button>
            
            <div className="hidden sm:block h-6 w-px bg-border mx-1" />

            <SixHiPillTabs tabs={tabs} activeId={activeTab} onChange={setTab} />
          </div>
        }
      />

      {machineActive && (
        <div className="shrink-0 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-warning">Machine status</p>
            <p className="text-sm font-semibold text-foreground mt-0.5">
              Active order <span className="font-mono text-primary">{machineActiveCard ? displayMotherCoilId(machineActiveCard) : machineActive.batchNumber}</span> · {machineActive.subProcess === 'ROLLING' ? 'Rolling' : 'Skin Pass'}
            </p>
          </div>
          <SixHiStatusPill status={machineActive.status as SixHiOrderStatus} />
        </div>
      )}

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
            placeholder="Search mother coil, Slit ID, customer, batch…"
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
              {subProcessLabel} Queue · {visibleOrderCount} orders
            </h2>
            {machineActive && (
              <span className="text-xs font-semibold text-warning">
                Active: {machineActive.batchNumber}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-auto">
            {/* Show spinner only on first/empty load — never during background refreshes */}
            {loading && visibleOrderCount === 0 && <p className="text-center text-muted-foreground py-12 text-base">Loading queue…</p>}
            {!loading && visibleOrderCount === 0 && (
              <div className="text-center py-12 px-6">
                <p className="text-muted-foreground text-base mb-2">No orders match this filter</p>
              </div>
            )}
            {!loading && showOperationalSections && filteredBacklog.length > 0 && (
              <>
                <div className="px-5 py-2 bg-destructive/10 border-b border-destructive/20">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">
                    Backlog · {filteredBacklog.length}
                  </p>
                </div>
                {sortQueueSection(filteredBacklog).map((card) => renderQueueRow(card, { backlog: true }))}
              </>
            )}
            {!loading && showOperationalSections && filteredPending.length > 0 && (
              <>
                <div className="px-5 py-2 bg-secondary/60 border-b border-border">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Awaiting machine · {filteredPending.length}
                  </p>
                </div>
                {sortQueueSection(filteredPending).map((card) => renderQueueRow(card, { pending: true }))}
              </>
            )}
            {!loading && showOperationalSections && filteredAssigned.length > 0 && (
              <div className="px-5 py-2 bg-muted/30 border-b border-border">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {queueMachine} queue · {filteredAssigned.length}
                </p>
              </div>
            )}
            {!loading && showOperationalSections && sortQueueSection(filteredAssigned).map((card) => renderQueueRow(card))}
            {!loading && showCompletedSection && filteredCompleted.length > 0 && (
              <>
                <div className="px-5 py-2 bg-secondary/60 border-b border-border">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Completed · {filteredCompleted.length}
                  </p>
                </div>
                {sortQueueSection(filteredCompleted).map((card) => renderQueueRow(card))}
              </>
            )}
            {!loading && showRejectedSection && filteredRejected.length > 0 && (
              <>
                <div className="px-5 py-2 bg-destructive/10 border-b border-destructive/20">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">
                    {ORDER_HOLD_STATUS_LABEL} · {filteredRejected.length}
                  </p>
                </div>
                {sortQueueSection(filteredRejected).map((card) => renderQueueRow(card))}
              </>
            )}
          </div>
        </div>

        <aside className="order-1 lg:order-2 w-full lg:w-[400px] shrink-0 min-h-0 lg:h-full flex flex-col overflow-hidden max-h-[min(480px,45vh)] lg:max-h-none">
          <SixHiBatchDetailPanel
            batch={selected}
            subProcessLabel={subProcessLabel}
            currentMill={queueMachine}
            machineActiveBatch={machineActive?.batchNumber ?? null}
            combinedCount={selectedProductionOrders.length}
            combinedBatchNumbers={selectedProductionOrders.map((c) => c.batchNumber)}
            onOpen={moveSelectedToProduction}
            onViewCompleted={moveSelectedToProduction}
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

      {!isTransferMode && selectedProductionOrders.length > 1 && selected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] bg-foreground text-background rounded-full pl-6 pr-2 py-2 shadow-2xl flex items-center gap-4 animate-in slide-in-from-bottom-8 max-w-[95vw]">
          <span className="font-bold text-sm tracking-wide whitespace-nowrap">
            {selectedProductionOrders.length} compatible orders selected
          </span>
          <button
            type="button"
            className="bg-success hover:bg-success/90 text-white text-sm font-bold px-4 py-2 rounded-full transition-colors whitespace-nowrap"
            onClick={moveSelectedToProduction}
          >
            {combinedActionLabel(selectedProductionOrders)}
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
