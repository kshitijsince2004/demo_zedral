import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { useSixHiHubQueue } from '../../hooks/useSixHiHubQueue';
import {
  hubTabsForMill,
  normalizeMillTab,
} from '../../lib/millConfig';
import { TwoHiRewindingHub } from './TwoHiRewindingHub';
import { currentPlantDate } from '../../lib/dateFormat';
import { Search, RefreshCw } from 'lucide-react';
import type { SixHiOrderStatus, SixHiQueueCard } from '@m1/shared-validation';
import { SixHiPillTabs } from '../../components/sixHi/SixHiPillTabs';
import { SixHiStatusPill } from '../../components/sixHi/SixHiStatusPill';
import { SixHiBatchDetailPanel } from '../../components/sixHi/SixHiBatchDetailPanel';
import { SixHiQueueRow } from '../../components/sixHi/SixHiQueueRow';
import { MachineAllocationModal, type CrmMillCode, type MachineAllocationMode } from '../../components/sixHi/MachineAllocationModal';
import { invalidateMachineRegistryCache } from '../../lib/machineRegistry';
import { ApiError } from '../../lib/apiClient';
import { invalidateAfterWrite } from '../../lib/sync/invalidateAfterWrite';
import { notifyProductionChanged } from '../../lib/productionSync';
import {
  allocateMachine,
  startCombinedOrdersImmediate,
  transferMachines,
} from '../../lib/sync/sixHiWrites';
import { useAuthStore } from '../../lib/authStore';
import { useShiftStore } from '../../store/shiftStore';
import { useSixHiStore } from '../../store/sixHiStore';
import { useManualRerollEntry } from '../../hooks/useTenantFlag';
import { showManualRerollEnterButton, withManualRerollTab } from '../../lib/manualRerollUi';
import { ManualRerollHub } from '../../components/sixHi/manualReroll/ManualRerollHub';
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
} from '../../lib/sixHiOrderIdentity';
import { ORDER_HOLD_STATUS_LABEL } from '../../lib/orderLabels';
import { DataFreshnessBadge } from '../../components/DataFreshnessBadge';
import { VirtualizedList } from '../../components/VirtualizedList';

function applyOptimisticEndOverlay(
  data: {
    queue: SixHiQueueCard[];
    pendingAllocation: SixHiQueueCard[];
    backlog: SixHiQueueCard[];
    completed: SixHiQueueCard[];
    rejected: SixHiQueueCard[];
  },
  endingBatches: string[],
) {
  if (endingBatches.length === 0) return data;
  const batchSet = new Set(endingBatches);
  const moved: SixHiQueueCard[] = [];
  const strip = (cards: SixHiQueueCard[]) => cards.filter((c) => {
    if (!batchSet.has(c.batchNumber)) return true;
    moved.push({ ...c, status: 'COMPLETED' as SixHiOrderStatus });
    return false;
  });
  return {
    queue: strip(data.queue),
    pendingAllocation: strip(data.pendingAllocation),
    backlog: strip(data.backlog),
    completed: dedupeQueueCards([
      ...data.completed.filter((c) => !batchSet.has(c.batchNumber)),
      ...moved,
    ]),
    rejected: data.rejected,
  };
}

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
  const [searchParams] = useSearchParams();
  const { machineCode: pathMachine } = useWorkspaceBase();
  const { showEntry } = useManualRerollEntry(pathMachine);
  if (showEntry && searchParams.get('tab') === 'reroll') return <ManualRerollHub />;
  const activeTab = normalizeMillTab(pathMachine, searchParams.get('tab'));
  // Rewinding is a separate pipeline (prod_rwd) — never feed it through SixHi getQueue.
  if (activeTab === 'rewinding') return <TwoHiRewindingHub />;
  return <SixHiCrmHub />;
}

function SixHiCrmHub() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { shiftCode, shiftLogId, detectedShift } = useShiftStore();
  const openWorkspace = useSixHiStore((s) => s.openWorkspace);
  const machineActive = useSixHiStore((s) => s.machineActive);
  const setProcessTab = useSixHiStore((s) => s.setProcessTab);
  const queueRefreshToken = useSixHiStore((s) => s.queueRefreshToken);
  const setMachineCode = useSixHiStore((s) => s.setMachineCode);
  const optimisticEndingBatches = useSixHiStore((s) => s.optimisticEndingBatches);
  const { machineCode: pathMachine } = useWorkspaceBase();
  const logout = useAuthStore((s) => s.logout);

  const activeTab = normalizeMillTab(pathMachine, searchParams.get('tab'));
  const { showEntry: showRerollTab } = useManualRerollEntry(pathMachine);
  const tabs = withManualRerollTab(hubTabsForMill(pathMachine), showRerollTab);
  const statusFilter = (searchParams.get('status')?.toUpperCase() as StatusFilter) || 'ALL';
  const apiSubProcess = activeTab === 'rolling' ? 'ROLLING' : 'SKIN_PASS';
  const subProcessLabel = activeTab === 'rolling' ? 'Rolling' : 'Skin Pass';

  const [viewDate, setViewDate] = useState(currentPlantDate());
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [allocOpen, setAllocOpen] = useState(false);
  const [allocMode, setAllocMode] = useState<MachineAllocationMode>('production');
  const [allocBatches, setAllocBatches] = useState<SixHiQueueCard[]>([]);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const previousCompletedRef = useRef<SixHiQueueCard[]>([]);
  const optimisticEndingSet = useMemo(() => new Set(optimisticEndingBatches), [optimisticEndingBatches]);

  const [isTransferMode, setIsTransferMode] = useState(false);
  const [selectedForTransfer, setSelectedForTransfer] = useState<Set<string>>(new Set());
  const [anchorBatch, setAnchorBatch] = useState<string | null>(null);
  const [autoCombinedBatchNumbers, setAutoCombinedBatchNumbers] = useState<Set<string>>(new Set());
  /** Full compatible pool for the current anchor (SPEC A: N of M selected). */
  const [compatiblePool, setCompatiblePool] = useState<Set<string>>(new Set());
  const combinedSelectionManual = useRef(false);

  const date = viewDate;
  // Operational plant day from shift detection (yesterday during overnight C).
  const operationalDate = detectedShift?.prodDate || currentPlantDate();
  // Only send shift once session/bootstrap confirmed — default 'A' was poisoning completed/hold.
  const shift = detectedShift?.shiftCode || (shiftLogId ? shiftCode : undefined);
  const queueMachine = pathMachine;
  const shiftReady = Boolean(shiftLogId || shift);
  const userRoles = useAuthStore((s) => s.user?.roles || []);
  const canTransfer = userRoles.includes('ADMIN') || userRoles.includes('MACHINE_HEAD');

  const {
    data: queueData,
    error: queueFetchError,
    isLoading,
    isValidating,
    mutate: mutateQueue,
  } = useSixHiHubQueue({
    apiSubProcess,
    date,
    queueMachine,
    shift,
    shiftLogId,
    operationalDate,
    refreshToken: queueRefreshToken,
  });

  const queueError = queueFetchError
    ? (queueFetchError instanceof ApiError
      ? queueFetchError.message
      : queueFetchError instanceof Error
        ? queueFetchError.message
        : 'Failed to load queue')
    : null;

  useEffect(() => {
    if (queueFetchError instanceof ApiError && queueFetchError.status === 401) {
      logout();
      navigate('/login', { replace: true });
    }
  }, [queueFetchError, logout, navigate]);

  const {
    queue,
    pendingQueue,
    backlogQueue,
    completedQueue,
    rejectedQueue,
  } = useMemo(() => {
    const base = queueData ?? {
      queue: [],
      pendingAllocation: [],
      backlog: [],
      completed: previousCompletedRef.current,
      rejected: [],
    };
    let completed = base.completed;
    if (!shiftReady && previousCompletedRef.current.length > 0) {
      completed = previousCompletedRef.current;
    } else if (shiftReady && queueData) {
      previousCompletedRef.current = queueData.completed;
    }
    const overlay = applyOptimisticEndOverlay({ ...base, completed }, optimisticEndingBatches);
    return {
      queue: overlay.queue,
      pendingQueue: overlay.pendingAllocation,
      backlogQueue: overlay.backlog,
      completedQueue: overlay.completed,
      rejectedQueue: overlay.rejected,
    };
  }, [queueData, shiftReady, optimisticEndingBatches]);

  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!shiftLogId) return;
    previousCompletedRef.current = [];
    void mutateQueue();
  }, [shiftLogId, mutateQueue]);

  // Align date filter to operational prod date when the live session's day differs
  // from the calendar (overnight Shift C / SESSION pin past midnight).
  useEffect(() => {
    if (!detectedShift?.prodDate) return;
    setViewDate((prev) => (prev === currentPlantDate() && detectedShift.prodDate !== prev
      ? detectedShift.prodDate
      : prev));
  }, [detectedShift?.prodDate]);

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

  const allOrders = useMemo(
    () => dedupeQueueCards([...backlogQueue, ...pendingQueue, ...queue, ...completedQueue, ...rejectedQueue]),
    [backlogQueue, pendingQueue, queue, completedQueue, rejectedQueue],
  );

  const machineActiveCard = useMemo(
    () => (machineActive ? allOrders.find((c) => c.batchNumber === machineActive.batchNumber) : undefined),
    [allOrders, machineActive],
  );

  const applyCombinedSelection = useCallback((anchor: SixHiQueueCard, opts?: { keepPicks?: boolean }) => {
    const compatible = findCompatibleOrdersForCombine(anchor, allOrders, queueMachine);
    const ids = new Set(compatible.map((o) => o.batchNumber));
    setCompatiblePool(ids);
    if (opts?.keepPicks) {
      setAutoCombinedBatchNumbers((prev) => new Set([...prev].filter((b) => ids.has(b))));
    } else {
      setAutoCombinedBatchNumbers(ids);
    }
  }, [allOrders, queueMachine]);

  useEffect(() => {
    setAnchorBatch(null);
    setAutoCombinedBatchNumbers(new Set());
    setCompatiblePool(new Set());
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
    if (!selectedBatch) {
      setAutoCombinedBatchNumbers(new Set());
      setCompatiblePool(new Set());
      return;
    }
    const card = allOrders.find((c) => c.batchNumber === selectedBatch);
    if (!card) return;
    applyCombinedSelection(card, { keepPicks: combinedSelectionManual.current });
  }, [selectedBatch, allOrders, applyCombinedSelection]);

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

  // Hold cards are excluded from matchesFilter(ALL) so they don't mix into operational
  // sections — include them explicitly for All + Order Hold filters (same as Completed).
  const filteredRejected = useMemo(() => {
    if (statusFilter !== 'ALL' && statusFilter !== 'REJECTED') return [];
    return rejectedQueue.filter((c) => matchesSearch(c, search));
  }, [rejectedQueue, statusFilter, search]);

  const showOperationalSections = statusFilter !== 'COMPLETED' && statusFilter !== 'REJECTED';
  const showCompletedSection = statusFilter === 'ALL' || statusFilter === 'COMPLETED';
  const showRejectedSection = statusFilter === 'ALL' || statusFilter === 'REJECTED';
  const visibleOrderCount = (showOperationalSections
    ? filteredBacklog.length + filteredPending.length + filteredAssigned.length
    : 0)
    + (showCompletedSection ? filteredCompleted.length : 0)
    + (showRejectedSection ? filteredRejected.length : 0);
  const loading = isLoading && !queueData;
  const showColdStartLoading = loading && visibleOrderCount === 0;
  const showEmptyState = !showColdStartLoading && !loading && visibleOrderCount === 0;

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
    if (!anchorBatch) return;
    const anchor = allOrders.find((c) => c.batchNumber === anchorBatch);
    if (!anchor) return;
    applyCombinedSelection(anchor, { keepPicks: combinedSelectionManual.current });
  }, [allOrders, anchorBatch, applyCombinedSelection]);

  const cancelCombinedSelection = () => {
    if (!anchorBatch) return;
    combinedSelectionManual.current = true;
    // Keep full pool so checkboxes remain; selection collapses to the anchor only.
    setAutoCombinedBatchNumbers(new Set([anchorBatch]));
  };

  /** Toggle one compatible order in/out of the combined start set (may go to 0). */
  const toggleCombinedBatch = (batchNumber: string, event: MouseEvent) => {
    event.stopPropagation();
    if (!compatiblePool.has(batchNumber) || compatiblePool.size < 2) return;
    combinedSelectionManual.current = true;
    setAutoCombinedBatchNumbers((prev) => {
      const next = new Set(prev);
      if (next.has(batchNumber)) next.delete(batchNumber);
      else next.add(batchNumber);
      return next;
    });
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

  const pushCombinedToStore = (matchingCards: SixHiQueueCard[], pickedCards: SixHiQueueCard[]) => {
    const primaryBatch = anchorBatch && matchingCards.some((c) => c.batchNumber === anchorBatch)
      ? anchorBatch
      : (pickedCards[0] ?? matchingCards[0])?.batchNumber;
    if (!primaryBatch) return;
    const combined = buildCombinedRunFromCards(matchingCards, primaryBatch);
    if (combined) {
      useSixHiStore.getState().setCombinedRun(combined, {
        selectedBatches: pickedCards.map((c) => c.batchNumber),
      });
    } else {
      useSixHiStore.getState().setCombinedRun(null);
    }
  };

  const openCombinedView = (cards: SixHiQueueCard[]) => {
    if (cards.length === 0) return;
    const anchor = allOrders.find((c) => c.batchNumber === anchorBatch) ?? cards[0];
    const matching = findCompatibleOrdersForCombine(anchor, allOrders, queueMachine);
    pushCombinedToStore(matching, cards);
    const primaryCard = cards.find((c) => c.batchNumber === (anchorBatch ?? cards[0].batchNumber)) ?? cards[0];
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
    await startCombinedOrdersImmediate(batchNumbers);
    // After start the run *is* the started subset.
    const started = buildCombinedRunFromCards(cards, primaryBatch);
    useSixHiStore.getState().setCombinedRun(started, { selectedBatches: batchNumbers });
    setAutoCombinedBatchNumbers(new Set());
    combinedSelectionManual.current = false;
    notifyProductionChanged();
    invalidateAfterWrite();
    await mutateQueue();
    openProductionForCard(cards.find((c) => c.batchNumber === primaryBatch) ?? cards[0]);
  };

  const moveSelectedToProduction = () => {
    const cards = selectedProductionOrders;
    if (cards.length === 0) return;
    if (cards.length > 1 && cardsShareProductionAction(cards)) {
      if (cards.every(isStartable)) {
        void startCombinedProduction(cards).catch((err) => {
          setActionError(err instanceof Error ? err.message : 'Failed to start combined production');
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
    openWorkspace(card.batchNumber, card);
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
        await allocateMachine(batch.batchNumber, machineCode);
      }
      invalidateMachineRegistryCache();
      invalidateAfterWrite();
      const targetBatch = allocBatches[0]?.batchNumber;
      setAllocOpen(false);
      setAllocBatches([]);
      notifyProductionChanged();
      await mutateQueue();
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

    await transferMachines(
      machineCode,
      allocBatches.map((b) => b.batchNumber),
    );
    invalidateMachineRegistryCache();
    invalidateAfterWrite();
    setAllocOpen(false);
    setIsTransferMode(false);
    setSelectedForTransfer(new Set());
    notifyProductionChanged();
    setAllocBatches([]);
    await mutateQueue();
  };

  const handleTransferToggle = useCallback((batchNumber: string) => {
    setSelectedForTransfer((prev) => {
      const next = new Set(prev);
      if (next.has(batchNumber)) next.delete(batchNumber);
      else next.add(batchNumber);
      return next;
    });
  }, []);

  const renderQueueRow = (card: SixHiQueueCard, opts?: { pending?: boolean }) => (
    <SixHiQueueRow
      key={card.batchNumber}
      card={card}
      pending={opts?.pending}
      isEnding={optimisticEndingSet.has(card.batchNumber)}
      isSelected={isTransferMode ? selectedForTransfer.has(card.batchNumber) : card.batchNumber === selectedBatch}
      isTransferMode={isTransferMode}
      isInCombinedSelection={autoCombinedBatchNumbers.has(card.batchNumber)}
      showCombineCheckbox={!isTransferMode && compatiblePool.size > 1 && compatiblePool.has(card.batchNumber)}
      isActive={machineActive?.batchNumber === card.batchNumber}
      combinedSelectionCount={selectedProductionOrders.length}
      onSelect={selectOrder}
      onTransferToggle={handleTransferToggle}
      onCombineToggle={toggleCombinedBatch}
    />
  );

  const sortedAssigned = useMemo(
    () => sortQueueSection(filteredAssigned),
    [sortQueueSection, filteredAssigned],
  );

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
                void mutateQueue().finally(() => setSyncing(false));
              }}
              title="Refresh Queue"
              className="min-h-9 px-3 rounded-md border border-border bg-white text-muted-foreground hover:bg-secondary flex items-center justify-center transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin text-primary' : ''}`} />
            </button>
            <DataFreshnessBadge />

            <div className="hidden sm:block h-6 w-px bg-border mx-1" />

            {showManualRerollEnterButton(showRerollTab, pathMachine, activeTab) && (
              <button
                type="button"
                onClick={() => setTab('reroll')}
                className="text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-md border border-primary bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Manual Re-Roll
              </button>
            )}

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

      {(queueError || actionError) && (
        <div className="shrink-0 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {queueError ?? actionError}
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
            {isValidating && !showColdStartLoading && visibleOrderCount > 0 && (
              <span className="text-xs font-semibold text-muted-foreground">Refreshing…</span>
            )}
            {machineActive && (
              <span className="text-xs font-semibold text-warning">
                Active: {machineActive.batchNumber}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-auto" data-queue-scroll>
            {/* Show spinner only on first/empty load — never during background refreshes */}
            {showColdStartLoading && <p className="text-center text-muted-foreground py-12 text-base">Loading queue…</p>}
            {showEmptyState && (
              <div className="text-center py-12 px-6">
                <p className="text-muted-foreground text-base mb-2">No orders match this filter</p>
              </div>
            )}
            {showOperationalSections && filteredBacklog.length > 0 && (
              <>
                <div className="px-5 py-2 bg-destructive/10 border-b border-destructive/20">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">
                    Backlog · {filteredBacklog.length}
                  </p>
                </div>
                {sortQueueSection(filteredBacklog).map((card) => renderQueueRow(card))}
              </>
            )}
            {showOperationalSections && filteredPending.length > 0 && (
              <>
                <div className="px-5 py-2 bg-secondary/60 border-b border-border">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Awaiting machine · {filteredPending.length}
                  </p>
                </div>
                {sortQueueSection(filteredPending).map((card) => renderQueueRow(card, { pending: true }))}
              </>
            )}
            {showOperationalSections && filteredAssigned.length > 0 && (
              <div className="px-5 py-2 bg-muted/30 border-b border-border">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  {queueMachine} queue · {filteredAssigned.length}
                </p>
              </div>
            )}
            {showOperationalSections && sortedAssigned.length > 12 ? (
              <VirtualizedList
                items={sortedAssigned}
                estimateSize={88}
                className="min-h-[240px] max-h-[min(60vh,720px)]"
                getKey={(card) => card.batchNumber}
                renderItem={(card) => renderQueueRow(card)}
              />
            ) : (
              showOperationalSections && sortedAssigned.map((card) => renderQueueRow(card))
            )}
            {showCompletedSection && filteredCompleted.length > 0 && (
              <>
                <div className="px-5 py-2 bg-secondary/60 border-b border-border">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Completed · {filteredCompleted.length}
                  </p>
                </div>
                {sortQueueSection(filteredCompleted).map((card) => renderQueueRow(card))}
              </>
            )}
            {showRejectedSection && filteredRejected.length > 0 && (
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

      {!isTransferMode && compatiblePool.size > 1 && selected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] bg-foreground text-background rounded-full pl-6 pr-2 py-2 shadow-2xl flex items-center gap-4 animate-in slide-in-from-bottom-8 max-w-[95vw]">
          <span className="font-bold text-sm tracking-wide whitespace-nowrap">
            {selectedProductionOrders.length} of {compatiblePool.size} compatible selected
          </span>
          <button
            type="button"
            className="bg-success hover:bg-success/90 text-white text-sm font-bold px-4 py-2 rounded-full transition-colors whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none"
            disabled={selectedProductionOrders.length === 0}
            onClick={moveSelectedToProduction}
          >
            {selectedProductionOrders.length === 0
              ? 'Select an order'
              : selectedProductionOrders.length === 1
                ? 'Start'
                : combinedActionLabel(selectedProductionOrders)}
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
