import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import useSWR from 'swr';
import { RefreshCw, Search, Play } from 'lucide-react';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import { hubTabsForMill } from '../../lib/millConfig';
import { useManualRerollEntry } from '../../hooks/useTenantFlag';
import { showManualRerollEnterButton, withManualRerollTab } from '../../lib/manualRerollUi';
import { apiClient } from '../../lib/apiClient';
import { notifyProductionChanged, subscribeProductionSync } from '../../lib/productionSync';
import { jsonEqual } from '../../lib/silentRefresh';
import {
  rewindingCardToPrefill,
  type RewindingQueueCard,
} from '../../lib/rewindingQueue';
import { allocateRwdMachine, prepareCombinedRwdOrders } from '../../lib/rewindingWrites';
import {
  findRwdCompatibleOrders,
  rwdCombinedActionLabel,
  rwdCombineStatusGroup,
  rwdGroupWeightMt,
} from '../../lib/siblingSelect';
import { useSixHiStore } from '../../store/sixHiStore';
import { SixHiPillTabs } from '../../components/sixHi/SixHiPillTabs';
import { ZInput } from '../../components/primitives/ZInput';
import { ZPageHeader } from '../../components/ui/operator/ZPageHeader';
import { ZFilterPills } from '../../components/ui/operator/ZFilterPills';
import { ZButton } from '../../components/primitives/ZButton';
import { ZBadge } from '../../components/primitives/ZBadge';
import { formatOrderStatusLabel } from '../../lib/orderLabels';
import { RewindingMachineAllocationModal } from '../../components/rewinding/RewindingMachineAllocationModal';

type StatusFilter = 'ALL' | 'PENDING' | 'PREPARING' | 'IN_PROGRESS' | 'HOLD' | 'COMPLETED';

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'PREPARING', label: 'Preparing' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'HOLD', label: 'Order Hold' },
];

function matchesSearch(card: RewindingQueueCard, q: string): boolean {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  return (
    card.batchNumber.toLowerCase().includes(needle) ||
    card.coilNo.toLowerCase().includes(needle) ||
    card.displayCoilNo.toLowerCase().includes(needle) ||
    (card.slitId?.toLowerCase().includes(needle) ?? false) ||
    card.customerName.toLowerCase().includes(needle)
  );
}

function matchesStatus(card: RewindingQueueCard, filter: StatusFilter): boolean {
  const s = (card.status ?? 'PENDING').toUpperCase();
  if (filter === 'ALL') return s !== 'COMPLETED';
  if (filter === 'PENDING') return s === 'PENDING';
  if (filter === 'PREPARING') return s === 'PREPARING';
  if (filter === 'IN_PROGRESS') return s === 'IN_PROGRESS' || s === 'STOPPAGE';
  if (filter === 'HOLD') return s === 'REJECTED' || s === 'HOLD';
  return s === filter;
}

function statusTone(status?: string): 'warning' | 'info' | 'success' | 'destructive' | 'muted' | 'accent' {
  switch ((status ?? '').toUpperCase()) {
    case 'PENDING':
    case 'HOLD':
      return 'accent';
    case 'PREPARING':
      return 'info';
    case 'IN_PROGRESS':
    case 'RUNNING':
      return 'success';
    case 'STOPPAGE':
      return 'warning';
    case 'COMPLETED':
      return 'muted';
    case 'REJECTED':
      return 'accent';
    default:
      return 'muted';
  }
}

function isStartable(status?: string): boolean {
  const g = rwdCombineStatusGroup(status);
  return g === 0;
}

/** 2HI Rewinding hub — backed by txn.rwd_order via /rewinding/queue. */
export function TwoHiRewindingHub() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { basePath, machineCode } = useWorkspaceBase();
  const setProcessTab = useSixHiStore((s) => s.setProcessTab);
  const { showEntry: showRerollTab } = useManualRerollEntry(machineCode);
  const tabs = withManualRerollTab(hubTabsForMill(machineCode), showRerollTab);

  const rawStatus = (searchParams.get('status') ?? 'ALL').toUpperCase();
  const statusFilter: StatusFilter = STATUS_FILTERS.some((f) => f.id === rawStatus)
    ? (rawStatus as StatusFilter)
    : 'ALL';

  const [search, setSearch] = useState('');
  /** Empty = show all plan dates (imported rows often differ from today). */
  const [viewDate, setViewDate] = useState('');
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [allocOpen, setAllocOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [anchorBatch, setAnchorBatch] = useState<string | null>(null);
  const [selectedBatches, setSelectedBatches] = useState<Set<string>>(new Set());
  const [compatiblePool, setCompatiblePool] = useState<Set<string>>(new Set());
  const selectionManual = useRef(false);

  // Fetch whenever this hub is mounted (SixHiHub only mounts it for tab=rewinding on 2HI).
  const queueUrl = `/rewinding/queue?machine=${encodeURIComponent(machineCode || '2HI')}`;
  const { data, error, isLoading, isValidating, mutate } = useSWR(
    queueUrl,
    async (url) => {
      const res = await apiClient.get<{ queue: RewindingQueueCard[] }>(url);
      return res.queue ?? [];
    },
    {
      refreshInterval: 15_000,
      revalidateOnFocus: false,
      keepPreviousData: true,
      compare: (a, b) => jsonEqual(a, b),
    },
  );

  useEffect(() => subscribeProductionSync(() => { void mutate(); }), [mutate]);

  useEffect(() => {
    setProcessTab('rewinding');
    if (searchParams.get('tab') !== 'rewinding') {
      const next = new URLSearchParams(searchParams);
      next.set('tab', 'rewinding');
      setSearchParams(next, { replace: true });
    }
  }, [setProcessTab, searchParams, setSearchParams]);

  const setStatusFilter = (id: StatusFilter) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'rewinding');
    if (id === 'ALL') next.delete('status');
    else next.set('status', id);
    setSearchParams(next, { replace: true });
  };

  const queue = useMemo(() => data ?? [], [data]);
  const filtered = useMemo(
    () => queue.filter((c) => {
      if (!matchesStatus(c, statusFilter)) return false;
      if (!matchesSearch(c, search)) return false;
      if (viewDate && c.planDate && c.planDate !== viewDate) return false;
      return true;
    }),
    [queue, search, statusFilter, viewDate],
  );

  const filterOptions = useMemo(() => {
    const count = (id: StatusFilter) =>
      queue.filter((c) => {
        if (!matchesStatus(c, id)) return false;
        if (viewDate && c.planDate && c.planDate !== viewDate) return false;
        return true;
      }).length;
    return STATUS_FILTERS.map((f) => ({ ...f, count: count(f.id) }));
  }, [queue, viewDate]);

  const applyCombinedSelection = useCallback((card: RewindingQueueCard, opts?: { keepPicks?: boolean }) => {
    const matching = findRwdCompatibleOrders(card, queue);
    const pool = new Set(matching.map((c) => c.batchNumber));
    setCompatiblePool(pool);
    setAnchorBatch(card.batchNumber);
    if (opts?.keepPicks) {
      setSelectedBatches((prev) => {
        const next = new Set([...prev].filter((b) => pool.has(b)));
        if (next.size === 0) next.add(card.batchNumber);
        return next;
      });
    } else {
      setSelectedBatches(pool);
    }
  }, [queue]);

  const selectOrder = useCallback((card: RewindingQueueCard) => {
    setSelectedBatch(card.batchNumber);
    if (card.batchNumber === anchorBatch && selectionManual.current) return;
    selectionManual.current = false;
    applyCombinedSelection(card);
  }, [applyCombinedSelection, anchorBatch]);

  useEffect(() => {
    if (selectedBatch && filtered.some((c) => c.batchNumber === selectedBatch)) return;
    const first = filtered[0];
    if (!first) {
      setSelectedBatch(null);
      return;
    }
    selectOrder(first);
  }, [filtered, selectedBatch, selectOrder]);

  useEffect(() => {
    if (!anchorBatch) return;
    const anchor = queue.find((c) => c.batchNumber === anchorBatch);
    if (!anchor) return;
    applyCombinedSelection(anchor, { keepPicks: selectionManual.current });
  }, [queue, anchorBatch, applyCombinedSelection]);

  const toggleCombinedBatch = (batchNumber: string, event: MouseEvent) => {
    event.stopPropagation();
    if (!compatiblePool.has(batchNumber) || compatiblePool.size < 2) return;
    selectionManual.current = true;
    setSelectedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batchNumber)) next.delete(batchNumber);
      else next.add(batchNumber);
      return next;
    });
  };

  const cancelCombinedSelection = () => {
    if (!anchorBatch) return;
    selectionManual.current = true;
    setSelectedBatches(new Set([anchorBatch]));
  };

  const selected = filtered.find((c) => c.batchNumber === selectedBatch)
    ?? queue.find((c) => c.batchNumber === selectedBatch)
    ?? null;

  const productionOrders = useMemo(
    () => queue.filter((c) => selectedBatches.has(c.batchNumber)),
    [queue, selectedBatches],
  );

  const setTab = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    if (id !== 'rewinding') next.delete('status');
    setSearchParams(next);
  };

  const openCapture = async (card: RewindingQueueCard) => {
    const picked = productionOrders.length > 1
      && productionOrders.every((c) => rwdCombineStatusGroup(c.status) === rwdCombineStatusGroup(card.status))
      ? productionOrders
      : [card];
    const primary = picked.find((c) => c.batchNumber === anchorBatch) ?? picked[0] ?? card;

    if (picked.some((c) => !c.machineAllocated)) {
      setSelectedBatch(primary.batchNumber);
      setAllocOpen(true);
      return;
    }

    try {
      setActionError(null);
      if (picked.length > 1 && picked.every((c) => isStartable(c.status))) {
        await prepareCombinedRwdOrders(picked.map((c) => c.batchNumber));
        notifyProductionChanged();
        selectionManual.current = false;
        setSelectedBatches(new Set());
        await mutate();
      }
      navigate(`${basePath}/rewinding/${encodeURIComponent(primary.coilNo)}`, {
        state: {
          prefill: rewindingCardToPrefill(primary),
          batchNumber: primary.batchNumber,
          orderStatus: picked.length > 1 && picked.every((c) => isStartable(c.status))
            ? 'PREPARING'
            : primary.status,
          combinedBatchNumbers: picked.length > 1 ? picked.map((c) => c.batchNumber) : undefined,
        },
      });
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to prepare combined orders');
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-secondary p-4 md:p-5 gap-3 overflow-hidden">
      <ZPageHeader
        title="Machine"
        subtitle={`${machineCode} · Rewinding · ${filtered.length}${filtered.length !== queue.length ? ` shown · ${queue.length} in queue` : ` orders`}`}
        actions={
          <div className="flex gap-2 sm:gap-3 items-center flex-wrap justify-end w-full lg:w-auto">
            <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Plan date
              <input
                type="date"
                value={viewDate}
                onChange={(e) => {
                  setViewDate(e.target.value);
                  setSelectedBatch(null);
                }}
                title={viewDate ? undefined : 'All plan dates — pick a date to narrow'}
                className="min-h-9 rounded-md border border-border bg-white px-3 text-sm font-mono text-foreground normal-case tracking-normal"
              />
              {!viewDate && (
                <span className="normal-case tracking-normal font-medium text-muted-foreground">All</span>
              )}
            </label>
            {productionOrders.length > 1 && (
              <ZButton
                type="button"
                variant="danger"
                size="sm"
                onClick={cancelCombinedSelection}
                className="!bg-background !text-destructive border border-destructive/30 hover:!bg-destructive/5 !shadow-none"
              >
                Cancel Combined Order
              </ZButton>
            )}
            <ZButton
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setSyncing(true);
                void mutate().finally(() => setSyncing(false));
              }}
              title="Refresh Queue"
              className="!min-h-10 !h-10 !w-10 !px-0"
            >
              <RefreshCw className={`h-4 w-4 ${syncing || isValidating ? 'animate-spin text-primary' : ''}`} />
            </ZButton>
            <div className="hidden sm:block h-6 w-px bg-border mx-1" />
            {showManualRerollEnterButton(showRerollTab, machineCode || '2HI', 'rewinding') && (
              <button
                type="button"
                onClick={() => setTab('reroll')}
                className="text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-md border border-primary bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Manual Re-Roll
              </button>
            )}
            <SixHiPillTabs tabs={tabs} activeId="rewinding" onChange={setTab} />
          </div>
        }
      />

      {(error || actionError) && (
        <div className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {actionError
            ?? (error instanceof Error ? error.message : 'Failed to load rewinding queue')}
        </div>
      )}

      <div className="shrink-0 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[14rem] max-w-xl">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground z-10" aria-hidden />
          <ZInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search mother coil, Slit ID, customer, batch…"
            className="min-h-14 pl-12 text-base rounded-lg"
            mono={false}
          />
        </div>
        <div className="shrink-0 max-w-full overflow-x-auto">
          <ZFilterPills
            options={filterOptions}
            activeId={statusFilter}
            onChange={(id) => setStatusFilter(id)}
          />
        </div>
        {productionOrders.length > 1 && (
          <p className="text-sm font-medium font-mono tabular-nums shrink-0">
            Combined {productionOrders.length} · Σ {rwdGroupWeightMt(productionOrders).toFixed(2)} MT
          </p>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-4 overflow-hidden">
        <div className="flex-1 min-w-0 min-h-0 bg-background border border-border rounded-lg shadow-sm flex flex-col overflow-hidden order-2 lg:order-1">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <h2 className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Rewinding Queue · {filtered.length} orders
            </h2>
          </div>
          <div className="flex-1 overflow-auto p-3 space-y-2">
            {isLoading && !data && (
              <p className="text-center text-muted-foreground py-12 text-base">Loading queue…</p>
            )}
            {!isLoading && filtered.length === 0 && (
              <p className="text-center text-muted-foreground py-12 text-base">
                {queue.length === 0
                  ? 'No rewinding orders — import a plan or check Pending / All filters'
                  : 'No orders match this filter'}
              </p>
            )}
            {filtered.map((card) => {
              const selectedRow = card.batchNumber === selectedBatch;
              const status = card.status ?? 'PENDING';
              const showCombine = compatiblePool.size > 1 && compatiblePool.has(card.batchNumber);
              const inCombined = selectedBatches.has(card.batchNumber);
              return (
                <button
                  key={card.batchNumber}
                  type="button"
                  onClick={() => selectOrder(card)}
                  onDoubleClick={() => void openCapture(card)}
                  className={[
                    'w-full text-left rounded-lg border px-4 py-3 transition-colors min-h-[5.5rem]',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    selectedRow
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/25'
                      : 'border-border bg-background hover:border-primary/30 hover:bg-card',
                    inCombined && productionOrders.length > 1 ? 'ring-1 ring-success/25' : '',
                  ].join(' ')}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex items-start gap-2">
                      {showCombine && (
                        <input
                          type="checkbox"
                          className="mt-1.5 h-4 w-4 shrink-0 accent-primary"
                          checked={inCombined}
                          aria-label={`Include ${card.batchNumber} in combined start`}
                          onClick={(e) => toggleCombinedBatch(card.batchNumber, e)}
                          onChange={() => undefined}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground truncate">
                          {card.customerName || '—'}
                          <span className="mx-1.5">·</span>
                          Rewinding
                        </p>
                        <p className="font-mono text-base font-bold text-foreground mt-0.5 truncate">
                          {card.displayCoilNo}
                        </p>
                        <p className="text-[11px] font-mono tabular-nums text-muted-foreground mt-0.5 truncate">
                          {card.slitId ? `Slit ${card.slitId} · ` : ''}
                          Batch {card.batchNumber}
                          {card.planDate ? ` · ${card.planDate}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {inCombined && productionOrders.length > 1 && (
                        <ZBadge tone="success" label="Combined" />
                      )}
                      <ZBadge tone={statusTone(status)} label={formatOrderStatusLabel(status)} dot={status === 'IN_PROGRESS'} />
                    </div>
                  </div>
                  <p className="text-xs mt-2 text-foreground/90 font-mono tabular-nums">
                    {card.gradeCode || '—'} · {card.widthMm} mm · {card.thicknessMm} mm · {card.weightMt} MT
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="order-1 lg:order-2 w-full lg:w-[400px] shrink-0 min-h-0 lg:h-full flex flex-col overflow-hidden max-h-[min(480px,45vh)] lg:max-h-none">
          {!selected ? (
            <div className="bg-background border border-border rounded-lg p-6 h-full flex items-center justify-center text-muted-foreground text-base">
              Select a coil to view order details
            </div>
          ) : (
            <div className="bg-background border border-border rounded-lg h-full flex flex-col shadow-sm overflow-hidden">
              <div className="shrink-0 px-4 pt-4 pb-3 border-b border-border">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Order Details</p>
                  <ZBadge tone={statusTone(selected.status)} label={formatOrderStatusLabel(selected.status ?? 'PENDING')} />
                </div>
                <h2 className="font-mono text-2xl font-bold text-foreground mt-1 truncate">
                  {selected.displayCoilNo}
                </h2>
                <p className="text-xs font-mono tabular-nums text-muted-foreground mt-1">
                  {selected.slitId ? `Slit ${selected.slitId} · ` : ''}
                  Batch {selected.batchNumber}
                </p>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-4 py-3 flex-1 min-h-0 overflow-y-auto content-start">
                {([
                  ['Process', 'Rewinding'],
                  ['Station', selected.machineCode || machineCode],
                  ['Customer', selected.customerName || '—'],
                  ['Plan date', selected.planDate || '—', true],
                  ['Grade', selected.gradeCode || '—', true],
                  ['Width', `${selected.widthMm} mm`, true],
                  ['Thickness', `${selected.thicknessMm} mm`, true],
                  ['Weight', `${selected.weightMt} MT`, true],
                ] as [string, string, boolean?][]).map(([k, v, mono]) => (
                  <div key={k}>
                    <dt className="text-muted-foreground text-[10px] uppercase tracking-[0.14em] leading-tight font-medium">{k}</dt>
                    <dd className={`font-bold mt-1 text-sm leading-snug text-foreground ${mono ? 'font-mono tabular-nums' : ''}`}>{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="shrink-0 p-4 border-t border-border space-y-2">
                {productionOrders.length > 1 && (
                  <p className="text-sm font-medium font-mono tabular-nums text-center">
                    Combined {productionOrders.length} · Σ {rwdGroupWeightMt(productionOrders).toFixed(2)} MT
                  </p>
                )}
                {!selected.machineAllocated && (
                  <ZButton
                    variant="secondary"
                    className="w-full min-h-12"
                    onClick={() => setAllocOpen(true)}
                  >
                    Assign Machine
                  </ZButton>
                )}
                <ZButton variant="primary" className="w-full min-h-12" onClick={() => void openCapture(selected)}>
                  <Play className="h-4 w-4" />
                  {rwdCombinedActionLabel(productionOrders.length > 0 ? productionOrders : [selected])}
                </ZButton>
              </div>
            </div>
          )}
        </aside>
      </div>

      {compatiblePool.size > 1 && selected && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[90] bg-foreground text-background rounded-full pl-6 pr-2 py-2 shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom-8 max-w-[95vw]">
          <span className="font-bold text-sm tracking-wide whitespace-nowrap">
            {productionOrders.length} of {compatiblePool.size} compatible selected
          </span>
          {productionOrders.length > 1 && (
            <ZButton
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelCombinedSelection}
              className="!text-background border border-white/30 hover:!bg-white/10 whitespace-nowrap"
            >
              Cancel Combined
            </ZButton>
          )}
          <ZButton
            type="button"
            variant="primary"
            size="sm"
            className="!bg-success hover:!bg-success/90 !text-white whitespace-nowrap disabled:opacity-40"
            disabled={productionOrders.length === 0}
            onClick={() => { if (selected) void openCapture(selected); }}
          >
            {productionOrders.length <= 1
              ? 'Start'
              : rwdCombinedActionLabel(productionOrders)}
          </ZButton>
        </div>
      )}

      <RewindingMachineAllocationModal
        open={allocOpen && !!selected}
        batchNumber={selected?.batchNumber ?? ''}
        coilLabel={selected?.displayCoilNo ?? ''}
        suggested={machineCode}
        onClose={() => setAllocOpen(false)}
        onConfirm={async (code) => {
          const picked = productionOrders.length > 1 ? productionOrders : (selected ? [selected] : []);
          for (const c of picked) {
            await allocateRwdMachine(c.batchNumber, code);
          }
          setAllocOpen(false);
          await mutate();
          const primary = picked.find((c) => c.batchNumber === anchorBatch) ?? picked[0] ?? selected;
          if (!primary) return;
          if (picked.length > 1 && picked.every((c) => isStartable(c.status))) {
            await prepareCombinedRwdOrders(picked.map((c) => c.batchNumber));
            notifyProductionChanged();
            selectionManual.current = false;
            setSelectedBatches(new Set());
            await mutate();
          }
          navigate(`${basePath}/rewinding/${encodeURIComponent(primary.coilNo)}`, {
            state: {
              prefill: rewindingCardToPrefill({ ...primary, machineAllocated: true, machineCode: code }),
              batchNumber: primary.batchNumber,
              orderStatus: picked.length > 1 && picked.every((c) => isStartable(c.status))
                ? 'PREPARING'
                : primary.status,
              combinedBatchNumbers: picked.length > 1 ? picked.map((c) => c.batchNumber) : undefined,
            },
          });
        }}
      />

    </div>
  );
}
