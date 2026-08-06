import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Search } from 'lucide-react';
import { ZPageHeader } from '../ui/operator/ZPageHeader';
import { ZFilterPills } from '../ui/operator/ZFilterPills';
import { ZInput } from '../primitives/ZInput';
import { ZButton } from '../primitives/ZButton';
import { useProcessStore, type ProcessQueueCard, type QueueStatusFilter } from '../../store/processStore';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { useProcessHubQueue } from '../../hooks/useProcessHubQueue';
import { getProcessConfig, isProcessStationCode, type ProcessStationCode } from '../../lib/processConfig';
import { useShiftStore } from '../../store/shiftStore';
import { currentPlantDate } from '../../lib/dateFormat';
import { AnnBatchesPanel } from './bodies/AnnBatchesPanel';
import { findPklSiblingCoils, pklGroupWeightMt } from '../../lib/siblingSelect';
import {
  findRwdCompatibleOrders,
  rwdCombineStatusGroup,
  rwdCombinedActionLabel,
  rwdGroupWeightMt,
  type RwdCombineable,
} from '../../lib/siblingSelect';
import { ProcessQueueRow } from './ProcessQueueRow';
import { ProcessQueueDetailPanel } from './ProcessQueueDetailPanel';
import { RewindingManualOrderModal } from '../rewinding/RewindingManualOrderModal';
import { RewindingMachineAllocationModal } from '../rewinding/RewindingMachineAllocationModal';
import { rewindingCardToPrefill } from '../../lib/rewindingQueue';
import { notifyProductionChanged } from '../../lib/productionSync';
import {
  allocateRwdMachine,
  reinstateRwdOrder,
  startCombinedRwdOrders,
} from '../../lib/rewindingWrites';

const STATUS_FILTERS: { id: QueueStatusFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'HOLD', label: 'Order Hold' },
  { id: 'COMPLETED', label: 'Completed' },
];

/** RWD/2HI parity — Preparing separate from Pending. */
const RWD_STATUS_FILTERS: { id: QueueStatusFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'PREPARING', label: 'Preparing' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'HOLD', label: 'Order Hold' },
];

function matchesFilter(card: ProcessQueueCard, filter: QueueStatusFilter, isRwd: boolean): boolean {
  if (filter === 'ALL') return card.status !== 'COMPLETED';
  if (isRwd) {
    if (filter === 'PENDING') return card.status === 'PENDING';
    if (filter === 'PREPARING') return card.status === 'PREPARING';
    if (filter === 'IN_PROGRESS') return card.status === 'IN_PROGRESS' || card.status === 'STOPPAGE';
    if (filter === 'HOLD') return card.status === 'HOLD' || card.status === 'REJECTED';
    return card.status === filter;
  }
  // HRS/PKL: PREPARING under Pending, STOPPAGE under In Progress, REJECTED under Hold.
  if (filter === 'PENDING') return card.status === 'PENDING' || card.status === 'PREPARING';
  if (filter === 'IN_PROGRESS') return card.status === 'IN_PROGRESS' || card.status === 'STOPPAGE';
  if (filter === 'HOLD') return card.status === 'HOLD' || card.status === 'REJECTED';
  return card.status === filter;
}

/** RWD (and multi-batch slits share coil_no — key/select by batch when present. */
function queueCardKey(card: ProcessQueueCard): string {
  return card.batchNumber || card.journeyId || card.coilNo;
}

interface ProcessHubProps {
  processCode: string;
}

export function ProcessHub({ processCode }: ProcessHubProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { basePath } = useProcessWorkspaceBase();
  const config = getProcessConfig(processCode);
  const stationCode: ProcessStationCode = isProcessStationCode(processCode) ? processCode : 'HRS';
  const { shiftLogId, producedMt, targetMt } = useShiftStore();
  const {
    queue,
    statusFilter,
    queueRefreshToken,
    hubTab,
    captureError,
    clearCaptureError,
    setStatusFilter,
    setHubTab,
    setActiveCoil,
    setPklGroup,
    clearPklGroup,
    createManualCoil,
    busy,
    manualModalToken,
    consumeManualCoilRequest,
    pklGroupCoilNos,
    pklGroupWeightMt: groupWt,
  } = useProcessStore();

  const {
    error: swrError,
    isLoading: swrLoading,
    isValidating,
    mutate: mutateQueue,
  } = useProcessHubQueue(stationCode, queueRefreshToken);

  const [search, setSearch] = useState('');
  const [viewDate, setViewDate] = useState(currentPlantDate());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCoil, setManualCoil] = useState({
    coilNo: '', motherCoilNo: '', slitId: '', gradeCode: '', customerName: '', surface: '',
    widthMm: 0, thicknessMm: 0, weightMt: 0, routeRaw: '', heatNo: '', source: '',
    planDate: '', shiftCode: 'A',
  });
  const isPkl = processCode === 'PKL';
  const isHrs = processCode === 'HRS';
  const isRwd = processCode === 'RWD';
  /** URL status + side-nav Manual — HRS/PKL/RWD (hub Manual Add hidden). */
  const urlStatusTruth = isPkl || isHrs;
  const sideNavManualOnly = isPkl || isHrs || isRwd;
  /** Skin Pass–style list + detail for all coil queues (not ANN charge board). */
  const isQueueDesk = config.archetype !== 'B';
  const queueError = swrError
    ? (swrError instanceof Error ? swrError.message : 'Failed to load queue')
    : null;
  const [actionError, setActionError] = useState<string | null>(null);
  const loading = (swrLoading || isValidating) && queue.length === 0;
  /** RWD combine — matching pool + operator picks (6HI-style). */
  const [rwdAnchorBatch, setRwdAnchorBatch] = useState<string | null>(null);
  const [rwdSelectedBatches, setRwdSelectedBatches] = useState<Set<string>>(new Set());
  const [rwdCompatiblePool, setRwdCompatiblePool] = useState<Set<string>>(new Set());
  const rwdSelectionManual = useRef(false);

  const tab = searchParams.get('tab') ?? hubTab;

  const refresh = useCallback(async () => {
    await mutateQueue();
  }, [mutateQueue]);

  useEffect(() => {
    setHubTab(tab === 'chart' ? 'chart' : tab === 'charges' ? 'charges' : 'coils');
  }, [tab, setHubTab]);

  // Land on Completed (etc.) after End — All hides COMPLETED by design (6HI-style).
  // HRS/PKL: URL is source of truth (default ALL when query absent).
  useEffect(() => {
    const raw = (searchParams.get('status') ?? '').toUpperCase();
    const allowed: QueueStatusFilter[] = isRwd
      ? ['ALL', 'PENDING', 'PREPARING', 'IN_PROGRESS', 'HOLD', 'COMPLETED']
      : ['ALL', 'PENDING', 'IN_PROGRESS', 'HOLD', 'COMPLETED'];
    if (urlStatusTruth) {
      const next = (raw && allowed.includes(raw as QueueStatusFilter)
        ? raw
        : 'ALL') as QueueStatusFilter;
      if (statusFilter !== next) setStatusFilter(next);
      return;
    }
    if (!raw) return;
    if (allowed.includes(raw as QueueStatusFilter) && statusFilter !== raw) {
      setStatusFilter(raw as QueueStatusFilter);
    }
  }, [searchParams, setStatusFilter, statusFilter, isRwd, urlStatusTruth]);

  // ANN operators land on the base board first.
  useEffect(() => {
    if (processCode !== 'ANN') return;
    if (searchParams.get('tab')) return;
    setSearchParams({ tab: 'charges' }, { replace: true });
  }, [processCode, searchParams, setSearchParams]);

  const prevManualToken = useRef(0);
  useEffect(() => {
    if (!sideNavManualOnly) return;
    if (manualModalToken > prevManualToken.current) {
      setManualOpen(true);
    }
    prevManualToken.current = manualModalToken;
  }, [manualModalToken, sideNavManualOnly]);

  function closeManualModal() {
    setManualOpen(false);
    consumeManualCoilRequest();
  }

  const [rwdAllocOpen, setRwdAllocOpen] = useState(false);
  const [rwdAllocCard, setRwdAllocCard] = useState<ProcessQueueCard | null>(null);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return queue.filter((c) => matchesFilter(c, statusFilter, isRwd)).filter((c) => {
      if (isRwd && viewDate && c.planDate && c.planDate !== viewDate) return false;
      if (!q) return true;
      const hay = [
        c.coilNo,
        c.displayCoilNo,
        c.customerName,
        c.gradeCode,
        c.batchNumber,
        c.motherCoilNo,
        c.slitId,
        c.combination,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [queue, statusFilter, search, isRwd, viewDate]);

  const statusFilters = isRwd ? RWD_STATUS_FILTERS : STATUS_FILTERS;
  const filterOptions = useMemo(() => {
    const count = (id: QueueStatusFilter) =>
      queue.filter((c) => {
        if (!matchesFilter(c, id, isRwd)) return false;
        if (isRwd && viewDate && c.planDate && c.planDate !== viewDate) return false;
        return true;
      }).length;
    return statusFilters.map((f) => ({ ...f, count: count(f.id) }));
  }, [queue, statusFilters, isRwd, viewDate]);

  const selectedCard = useMemo(
    () => filtered.find((c) => queueCardKey(c) === selectedKey)
      ?? queue.find((c) => queueCardKey(c) === selectedKey)
      ?? null,
    [filtered, queue, selectedKey],
  );

  const selectedSet = useMemo(() => new Set(pklGroupCoilNos), [pklGroupCoilNos]);

  const applyRwdCombinedSelection = useCallback((card: ProcessQueueCard, opts?: { keepPicks?: boolean }) => {
    const matching = findRwdCompatibleOrders(card as RwdCombineable, queue as RwdCombineable[]);
    const pool = new Set(
      matching.map((c) => c.batchNumber).filter((b): b is string => !!b),
    );
    setRwdCompatiblePool(pool);
    setRwdAnchorBatch(card.batchNumber ?? null);
    if (opts?.keepPicks) {
      setRwdSelectedBatches((prev) => {
        const next = new Set([...prev].filter((b) => pool.has(b)));
        if (card.batchNumber && next.size === 0) next.add(card.batchNumber);
        return next;
      });
    } else {
      setRwdSelectedBatches(pool);
    }
  }, [queue]);

  const selectRwdOrder = useCallback((card: ProcessQueueCard) => {
    const key = queueCardKey(card);
    setSelectedKey(key);
    if (card.batchNumber === rwdAnchorBatch && rwdSelectionManual.current) return;
    rwdSelectionManual.current = false;
    applyRwdCombinedSelection(card);
  }, [applyRwdCombinedSelection, rwdAnchorBatch]);

  useEffect(() => {
    if (!isQueueDesk) return;
    if (selectedKey && filtered.some((c) => queueCardKey(c) === selectedKey)) return;
    const first = filtered[0];
    if (!first) {
      setSelectedKey(null);
      return;
    }
    if (isRwd) selectRwdOrder(first);
    else setSelectedKey(queueCardKey(first));
  }, [isQueueDesk, filtered, selectedKey, isRwd, selectRwdOrder]);

  useEffect(() => {
    if (!isRwd || !rwdAnchorBatch) return;
    const anchor = queue.find((c) => c.batchNumber === rwdAnchorBatch);
    if (!anchor) return;
    applyRwdCombinedSelection(anchor, { keepPicks: rwdSelectionManual.current });
  }, [isRwd, queue, rwdAnchorBatch, applyRwdCombinedSelection]);

  const toggleRwdCombinedBatch = (batchNumber: string, event: MouseEvent) => {
    event.stopPropagation();
    if (!rwdCompatiblePool.has(batchNumber) || rwdCompatiblePool.size < 2) return;
    rwdSelectionManual.current = true;
    setRwdSelectedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batchNumber)) next.delete(batchNumber);
      else next.add(batchNumber);
      return next;
    });
  };

  /** Collapse picks to the anchor only — pool + checkboxes stay (6HI Cancel Combined). */
  const cancelRwdCombinedSelection = () => {
    if (!rwdAnchorBatch) return;
    rwdSelectionManual.current = true;
    setRwdSelectedBatches(new Set([rwdAnchorBatch]));
  };

  const rwdProductionOrders = useMemo(
    () => (isRwd ? queue.filter((c) => c.batchNumber && rwdSelectedBatches.has(c.batchNumber)) : []),
    [isRwd, queue, rwdSelectedBatches],
  );

  async function openCapture(card: ProcessQueueCard) {
    if (processCode === 'RWD') {
      const anchorGroup = rwdCombineStatusGroup(card.status);
      const picked = rwdProductionOrders.length > 1
        && rwdProductionOrders.every((c) => rwdCombineStatusGroup(c.status) === anchorGroup)
        ? rwdProductionOrders
        : [card];
      const primary = picked.find((c) => c.batchNumber === rwdAnchorBatch) ?? picked[0] ?? card;
      if (!primary.batchNumber) return;
      // Already allocated → go straight; else open machine picker (RWD | 2HI).
      if (primary.machineAllocated && (primary.machineCode === 'RWD' || primary.machineCode === '2HI')) {
        await commitRwdCapture(picked, primary, primary.machineCode as 'RWD' | '2HI');
        return;
      }
      setRwdAllocCard(primary);
      setRwdAllocOpen(true);
      return;
    }
    if (processCode === 'PKL') {
      const siblings = findPklSiblingCoils(card, queue);
      const nos = siblings.map((s) => s.coilNo);
      setPklGroup(nos, pklGroupWeightMt(siblings));
      setActiveCoil(card.coilNo, {
        ...(card.prefill ?? {}),
        orderLines: card.orderLines,
        widthMm: card.widthMm,
        thicknessMm: card.thicknessMm,
        weightMt: card.weightMt,
        gradeCode: card.gradeCode,
        motherCoilNo: card.motherCoilNo,
        slitId: card.slitId,
        routeRaw: card.routeRaw,
      });
      navigate(`${basePath}/capture/${encodeURIComponent(card.coilNo)}`);
      return;
    }
    clearPklGroup();
    setActiveCoil(card.coilNo, {
      ...(card.prefill ?? {}),
      orderLines: card.orderLines,
      widthMm: card.widthMm,
      thicknessMm: card.thicknessMm,
      weightMt: card.weightMt,
      gradeCode: card.gradeCode,
      motherCoilNo: card.motherCoilNo,
      slitId: card.slitId,
      combination: card.combination,
      ...(card.routeRaw ? { routeRaw: card.routeRaw } : {}),
    });
    navigate(`${basePath}/capture/${encodeURIComponent(card.coilNo)}`);
  }

  async function commitRwdCapture(
    picked: ProcessQueueCard[],
    primary: ProcessQueueCard,
    machine: 'RWD' | '2HI',
  ) {
    const batchNumber = primary.batchNumber;
    if (!batchNumber) return;
    try {
      for (const c of picked) {
        if (!c.batchNumber) continue;
        if (c.status === 'HOLD' || c.status === 'REJECTED') {
          await reinstateRwdOrder(c.batchNumber, 'PREPARING');
        }
        await allocateRwdMachine(c.batchNumber, machine);
      }

      const startable = picked.every((c) =>
        c.status === 'PENDING'
        || c.status === 'PREPARING'
        || c.status === 'HOLD'
        || c.status === 'REJECTED',
      );
      if (picked.length > 1 && startable) {
        await startCombinedRwdOrders(picked.map((c) => c.batchNumber!));
        notifyProductionChanged();
        rwdSelectionManual.current = false;
        setRwdSelectedBatches(new Set());
      }

      navigate(`${basePath}/rewinding/${encodeURIComponent(primary.coilNo)}`, {
        state: {
          batchNumber,
          orderStatus: startable && picked.length > 1
            ? 'IN_PROGRESS'
            : (primary.status === 'HOLD' || primary.status === 'REJECTED')
              ? 'PREPARING'
              : primary.status,
          combinedBatchNumbers: picked.length > 1 ? picked.map((c) => c.batchNumber!) : undefined,
          prefill: rewindingCardToPrefill({
            batchNumber,
            coilNo: primary.coilNo,
            displayCoilNo: primary.displayCoilNo ?? primary.coilNo,
            slitId: primary.slitId,
            customerName: primary.customerName,
            gradeCode: primary.gradeCode,
            widthMm: primary.widthMm,
            thicknessMm: primary.thicknessMm,
            weightMt: primary.weightMt,
            machineAllocated: true,
            machineCode: machine,
            status: startable && picked.length > 1
              ? 'IN_PROGRESS'
              : (primary.status === 'HOLD' || primary.status === 'REJECTED')
                ? 'PREPARING'
                : primary.status,
            surfaceFinish: primary.surfaceFinish as 'M' | 'B' | undefined,
          }),
        },
      });
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to move to production');
    }
  }

  async function submitManual() {
    if (isPkl) {
      if (!manualCoil.coilNo.trim() || !manualCoil.weightMt || !manualCoil.widthMm || !manualCoil.routeRaw.trim()) {
        return;
      }
      await createManualCoil({
        coilNo: manualCoil.coilNo.trim(),
        motherCoilNo: manualCoil.motherCoilNo || undefined,
        slitId: manualCoil.slitId || undefined,
        gradeCode: manualCoil.gradeCode || 'NA',
        customerName: manualCoil.customerName || 'Manual',
        surface: manualCoil.surface || undefined,
        widthMm: manualCoil.widthMm,
        thicknessMm: manualCoil.thicknessMm || 0.1,
        weightMt: manualCoil.weightMt,
        routeRaw: manualCoil.routeRaw.trim(),
        heatNo: manualCoil.heatNo || undefined,
        source: manualCoil.source || undefined,
        planDate: manualCoil.planDate || undefined,
        shiftCode: manualCoil.shiftCode || 'A',
      });
    } else {
      await createManualCoil({
        coilNo: manualCoil.coilNo,
        gradeCode: manualCoil.gradeCode,
        customerName: manualCoil.customerName,
        widthMm: manualCoil.widthMm,
        thicknessMm: manualCoil.thicknessMm,
        weightMt: manualCoil.weightMt,
      });
    }
    setManualOpen(false);
    consumeManualCoilRequest();
  }

  const tabs = [
    { id: 'coils', label: processCode === 'ANN' ? 'Batches' : 'Coils' },
    ...(config.extraTabs ?? []),
    ...(config.archetype === 'B' ? [{ id: 'charges', label: 'Bases' }] : []),
  ];

  const subtitle = `Shift · ${producedMt ?? 0} / ${targetMt ?? '—'} MT`;
  const queueTitle = processCode === 'HRS' ? 'HRS Queue' : processCode === 'PKL' ? 'Pickling Queue' : config.label;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ZPageHeader
        title={isQueueDesk ? queueTitle : config.label}
        subtitle={isQueueDesk ? `${filtered.length} orders · ${subtitle}` : subtitle}
      />

      {queueError && (
        <div className="mx-4 mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <p className="font-bold">Cannot load {processCode} queue</p>
          <p className="mt-1">{queueError}</p>
        </div>
      )}

      {(captureError || actionError) && (
        <div className="mx-4 mt-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex gap-3 items-start justify-between">
          <div>
            <p className="font-bold">Cannot start / stoppage</p>
            <p className="mt-1">{captureError ?? actionError}</p>
          </div>
          <button
            type="button"
            className="text-xs font-bold uppercase shrink-0"
            onClick={() => {
              clearCaptureError();
              setActionError(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {tabs.length > 1 && (
        <div className="px-4 flex gap-2 border-b border-border">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              className={[
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px',
                tab === t.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground',
              ].join(' ')}
              onClick={() => {
                if (t.id === 'chart') navigate(`${basePath}/chart`);
                else setSearchParams({ tab: t.id });
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {config.archetype === 'B' && tab === 'charges' ? (
        <div className="flex-1 overflow-auto">
          <config.bodyComponent coilNo="" prefill={{}} shiftLogId={shiftLogId ?? ''} machineCode={processCode} />
        </div>
      ) : processCode === 'ANN' && tab === 'coils' ? (
        <AnnBatchesPanel />
      ) : (
        <>
          <div className="px-4 py-3 flex flex-wrap gap-3 items-center border-b border-border">
            {isRwd && (
              <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground shrink-0">
                Date
                <input
                  type="date"
                  value={viewDate}
                  onChange={(e) => {
                    setViewDate(e.target.value || currentPlantDate());
                    setSelectedKey(null);
                  }}
                  className="min-h-9 rounded-md border border-border bg-background px-3 text-sm font-mono text-foreground normal-case tracking-normal"
                />
              </label>
            )}
            <div className="flex-1 min-w-[14rem] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <ZInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isQueueDesk
                  ? 'Search mother coil, Slit ID, customer, batch…'
                  : 'Search coil…'}
                className={isQueueDesk ? 'min-h-14 pl-12 text-base' : 'pl-9'}
              />
            </div>
            <div className="shrink-0 max-w-full overflow-x-auto">
              <ZFilterPills
                options={filterOptions}
                activeId={statusFilter}
                onChange={(id) => {
                  const next = id as QueueStatusFilter;
                  setStatusFilter(next);
                  const nextParams = new URLSearchParams(searchParams);
                  if (next === 'ALL') nextParams.delete('status');
                  else nextParams.set('status', next);
                  setSearchParams(nextParams, { replace: true });
                }}
              />
            </div>
            {processCode === 'PKL' && pklGroupCoilNos.length > 0 && (
              <p className="text-sm font-medium tabular-nums">
                Selected {pklGroupCoilNos.length} · Σ {groupWt.toFixed(2)} MT
              </p>
            )}
            {isRwd && rwdProductionOrders.length > 1 && (
              <>
                <p className="text-sm font-medium tabular-nums">
                  Combined {rwdProductionOrders.length} · Σ {rwdGroupWeightMt(rwdProductionOrders).toFixed(2)} MT
                </p>
                <ZButton
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={cancelRwdCombinedSelection}
                  className="!bg-background !text-destructive border border-destructive/30 hover:!bg-destructive/5 !shadow-none"
                >
                  Cancel Combined Order
                </ZButton>
              </>
            )}
            <ZButton type="button" variant="secondary" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </ZButton>
            {/* ponytail: HRS/PKL/RWD Manual is side-nav only */}
            {!sideNavManualOnly && (
              <ZButton type="button" onClick={() => setManualOpen(true)}>Manual Add</ZButton>
            )}
          </div>

          {isQueueDesk ? (
            <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 p-4 overflow-hidden">
              <div className="flex-1 min-w-0 min-h-0 bg-background border border-border rounded-lg shadow-sm flex flex-col overflow-hidden order-2 lg:order-1">
                <div className="px-5 py-3 border-b border-border shrink-0">
                  <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    {queueTitle} · {filtered.length} orders
                  </h2>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto space-y-2 p-3" data-process-queue>
                  {filtered.map((card) => (
                    <ProcessQueueRow
                      key={queueCardKey(card)}
                      card={card}
                      selected={queueCardKey(card) === selectedKey}
                      processLabel={config.label}
                      onSelect={() => {
                        if (isRwd) selectRwdOrder(card);
                        else setSelectedKey(queueCardKey(card));
                      }}
                      onOpen={() => void openCapture(card)}
                      showCombineCheckbox={
                        isRwd
                        && !!card.batchNumber
                        && rwdCompatiblePool.size > 1
                        && rwdCompatiblePool.has(card.batchNumber)
                      }
                      isInCombinedSelection={
                        isRwd && !!card.batchNumber && rwdSelectedBatches.has(card.batchNumber)
                      }
                      combinedSelectionCount={rwdProductionOrders.length}
                      onCombineToggle={isRwd ? toggleRwdCombinedBatch : undefined}
                    />
                  ))}
                  {!loading && filtered.length === 0 && (
                    <p className="text-muted-foreground text-center py-12">No coils in queue</p>
                  )}
                </div>
              </div>
              <aside className="order-1 lg:order-2 w-full lg:w-[400px] shrink-0 min-h-0 lg:h-full flex flex-col overflow-hidden max-h-[min(480px,45vh)] lg:max-h-none">
                <ProcessQueueDetailPanel
                  card={selectedCard}
                  processLabel={config.label}
                  stationCode={processCode}
                  moveLabel={isRwd ? rwdCombinedActionLabel(rwdProductionOrders.length > 0 ? rwdProductionOrders : (selectedCard ? [selectedCard] : [])) : undefined}
                  combinedCount={isRwd ? rwdProductionOrders.length : 0}
                  combinedWeightMt={isRwd ? rwdGroupWeightMt(rwdProductionOrders) : undefined}
                  onMoveToProduction={() => {
                    if (selectedCard) void openCapture(selectedCard);
                  }}
                />
              </aside>
            </div>
          ) : (
            <div className="flex-1 overflow-auto p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((card) => {
                const selected = processCode === 'PKL' && selectedSet.has(card.coilNo);
                return (
                <button
                  key={queueCardKey(card)}
                  type="button"
                  onClick={() => void openCapture(card)}
                  className={[
                    'text-left border rounded-xl p-4 hover:border-primary/40 hover:bg-secondary/20 transition-colors',
                    selected ? 'border-primary bg-primary/5 ring-1 ring-primary/30' : '',
                  ].join(' ')}
                >
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-bold text-lg">{card.displayCoilNo ?? card.coilNo}</span>
                    <span className="text-[10px] uppercase px-2 py-0.5 rounded-full bg-secondary">{card.status}</span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{card.customerName}</p>
                  <p className="text-xs mt-2">
                    {card.gradeCode} · {card.widthMm} mm · {card.thicknessMm} mm · {card.weightMt} MT
                    {card.lineCount != null && card.lineCount > 1 ? ` · ${card.lineCount} lines` : ''}
                    {card.combination ? ` · ${card.combination}` : ''}
                  </p>
                  {processCode === 'PKL' && (card.motherCoilNo || card.slitId) && (
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Mother {card.motherCoilNo ?? '—'} · Slit {card.slitId ?? '—'}
                    </p>
                  )}
                </button>
                );
              })}
              {!loading && filtered.length === 0 && (
                <p className="text-muted-foreground col-span-full text-center py-12">No coils in queue</p>
              )}
            </div>
          )}
        </>
      )}

      {isRwd ? (
        <>
          <RewindingManualOrderModal
            open={manualOpen}
            defaultMachine="RWD"
            onClose={closeManualModal}
            onCreated={() => { void refresh(); }}
          />
          <RewindingMachineAllocationModal
            open={rwdAllocOpen && !!rwdAllocCard}
            batchNumber={rwdAllocCard?.batchNumber ?? ''}
            coilLabel={rwdAllocCard?.displayCoilNo ?? rwdAllocCard?.coilNo ?? ''}
            suggested="RWD"
            onClose={() => { setRwdAllocOpen(false); setRwdAllocCard(null); }}
            onConfirm={async (code) => {
              const primary = rwdAllocCard;
              if (!primary) return;
              const anchorGroup = rwdCombineStatusGroup(primary.status);
              const picked = rwdProductionOrders.length > 1
                && rwdProductionOrders.every((c) => rwdCombineStatusGroup(c.status) === anchorGroup)
                ? rwdProductionOrders
                : [primary];
              setRwdAllocOpen(false);
              setRwdAllocCard(null);
              await commitRwdCapture(picked, primary, code === '2HI' ? '2HI' : 'RWD');
            }}
          />
        </>
      ) : manualOpen ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-background rounded-xl p-6 w-full max-w-lg space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold">{isPkl ? 'Manual PKL Coil' : 'Manual Coil'}</h3>
            {isPkl ? (
              <>
                <ZInput label="Batch Number *" value={manualCoil.coilNo} onChange={(e) => setManualCoil({ ...manualCoil, coilNo: e.target.value })} />
                <div className="grid grid-cols-2 gap-2">
                  <ZInput label="Mother Coil" value={manualCoil.motherCoilNo} onChange={(e) => setManualCoil({ ...manualCoil, motherCoilNo: e.target.value })} />
                  <ZInput label="Slit ID" value={manualCoil.slitId} onChange={(e) => setManualCoil({ ...manualCoil, slitId: e.target.value })} />
                  <ZInput label="Customer" value={manualCoil.customerName} onChange={(e) => setManualCoil({ ...manualCoil, customerName: e.target.value })} />
                  <ZInput label="Grade" value={manualCoil.gradeCode} onChange={(e) => setManualCoil({ ...manualCoil, gradeCode: e.target.value })} />
                  <ZInput label="Surface" value={manualCoil.surface} onChange={(e) => setManualCoil({ ...manualCoil, surface: e.target.value })} />
                  <ZInput label="Width mm *" type="number" value={manualCoil.widthMm || ''} onChange={(e) => setManualCoil({ ...manualCoil, widthMm: Number(e.target.value) })} />
                  <ZInput label="Pre-Stage Thickness mm" type="number" value={manualCoil.thicknessMm || ''} onChange={(e) => setManualCoil({ ...manualCoil, thicknessMm: Number(e.target.value) })} />
                  <ZInput label="Coil Weight MT *" type="number" value={manualCoil.weightMt || ''} onChange={(e) => setManualCoil({ ...manualCoil, weightMt: Number(e.target.value) })} />
                </div>
                <ZInput label="Process Route *" value={manualCoil.routeRaw} onChange={(e) => setManualCoil({ ...manualCoil, routeRaw: e.target.value })} placeholder="P-4-R-F-C-LE-PKG" />
                <div className="grid grid-cols-2 gap-2">
                  <ZInput label="Heat No" value={manualCoil.heatNo} onChange={(e) => setManualCoil({ ...manualCoil, heatNo: e.target.value })} />
                  <ZInput label="Source" value={manualCoil.source} onChange={(e) => setManualCoil({ ...manualCoil, source: e.target.value })} />
                  <ZInput label="Plan Date" type="date" value={manualCoil.planDate} onChange={(e) => setManualCoil({ ...manualCoil, planDate: e.target.value })} />
                  <ZInput label="Shift" value={manualCoil.shiftCode} onChange={(e) => setManualCoil({ ...manualCoil, shiftCode: e.target.value })} />
                </div>
                <p className="text-[10px] text-muted-foreground">* Batch, Width, Weight, Route required</p>
              </>
            ) : (
              <>
                {(['coilNo', 'gradeCode', 'customerName'] as const).map((k) => (
                  <ZInput key={k} label={k} value={manualCoil[k]} onChange={(e) => setManualCoil({ ...manualCoil, [k]: e.target.value })} />
                ))}
                {(['widthMm', 'thicknessMm', 'weightMt'] as const).map((k) => (
                  <ZInput key={k} label={k} type="number" value={manualCoil[k]} onChange={(e) => setManualCoil({ ...manualCoil, [k]: Number(e.target.value) })} />
                ))}
              </>
            )}
            <div className="flex gap-2 justify-end">
              <ZButton type="button" variant="secondary" onClick={closeManualModal}>Cancel</ZButton>
              <ZButton type="button" onClick={() => void submitManual()} disabled={busy}>Add</ZButton>
            </div>
          </div>
        </div>
      ) : null}
      {isRwd && rwdCompatiblePool.size > 1 && selectedCard && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] bg-foreground text-background rounded-full pl-6 pr-2 py-2 shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-8 max-w-[95vw]">
          <span className="font-bold text-sm tracking-wide whitespace-nowrap">
            {rwdProductionOrders.length} of {rwdCompatiblePool.size} compatible selected
          </span>
          {rwdProductionOrders.length > 1 && (
            <button
              type="button"
              onClick={cancelRwdCombinedSelection}
              className="text-xs font-bold uppercase tracking-widest px-3 py-2 rounded-full border border-white/30 hover:bg-white/10 transition-colors whitespace-nowrap"
            >
              Cancel Combined
            </button>
          )}
          <button
            type="button"
            className="bg-success hover:bg-success/90 text-white text-sm font-bold px-4 py-2 rounded-full transition-colors whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none"
            disabled={rwdProductionOrders.length === 0}
            onClick={() => {
              if (selectedCard) void openCapture(selectedCard);
            }}
          >
            {rwdProductionOrders.length <= 1
              ? 'Start'
              : rwdCombinedActionLabel(rwdProductionOrders)}
          </button>
        </div>
      )}
    </div>
  );
}
