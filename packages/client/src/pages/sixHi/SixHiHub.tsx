import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useWorkspaceBase } from '../../hooks/useWorkspaceBase';
import {
  hubTabsForMill,
  normalizeMillTab,
  type MillProcessTab,
} from '../../lib/millConfig';
import { Search } from 'lucide-react';
import type { SixHiOrderStatus, SixHiQueueCard } from '@m1/shared-validation';
import { SixHiPillTabs } from '../../components/sixHi/SixHiPillTabs';
import { SixHiStatusPill } from '../../components/sixHi/SixHiStatusPill';
import { SixHiBatchDetailPanel } from '../../components/sixHi/SixHiBatchDetailPanel';
import { MachineAllocationModal, type CrmMillCode } from '../../components/sixHi/MachineAllocationModal';
import { apiClient, ApiError } from '../../lib/apiClient';
import { useAuthStore } from '../../lib/authStore';
import { useShiftStore } from '../../store/shiftStore';
import { useSixHiStore } from '../../store/sixHiStore';
import { ZInput } from '../../components/primitives/ZInput';
import { ZPageHeader } from '../../components/ui/operator/ZPageHeader';
import { ZFilterPills } from '../../components/ui/operator/ZFilterPills';

type TabId = MillProcessTab;
type StatusFilter = 'ALL' | SixHiOrderStatus;

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'PREPARING', label: 'Preparing' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'COMPLETED', label: 'Completed' },
];

function matchesFilter(card: SixHiQueueCard, filter: StatusFilter): boolean {
  if (filter === 'ALL') return true;
  return card.status === filter;
}

function matchesSearch(card: SixHiQueueCard, q: string): boolean {
  if (!q.trim()) return true;
  const needle = q.trim().toLowerCase();
  return (
    card.batchNumber.toLowerCase().includes(needle) ||
    card.motherCoil.toLowerCase().includes(needle) ||
    card.customer.toLowerCase().includes(needle)
  );
}

export function SixHiHub() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { shiftDate, shiftCode } = useShiftStore();
  const { openWorkspace, machineActive, setProcessTab, queueRefreshToken, setMachineCode } = useSixHiStore();
  const { basePath, machineCode: pathMachine } = useWorkspaceBase();
  const logout = useAuthStore((s) => s.logout);

  const activeTab = normalizeMillTab(pathMachine, searchParams.get('tab'));
  const tabs = hubTabsForMill(pathMachine);
  const statusFilter = (searchParams.get('status')?.toUpperCase() as StatusFilter) || 'ALL';
  const apiSubProcess = activeTab === 'rolling' ? 'ROLLING' : 'SKIN_PASS';
  const subProcessLabel = activeTab === 'rolling' ? 'Rolling' : 'Skin Pass';

  const [queue, setQueue] = useState<SixHiQueueCard[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [allocOpen, setAllocOpen] = useState(false);
  const [allocBatches, setAllocBatches] = useState<SixHiQueueCard[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);
  
  const [isTransferMode, setIsTransferMode] = useState(false);
  const [selectedForTransfer, setSelectedForTransfer] = useState<Set<string>>(new Set());

  const date = shiftDate || new Date().toISOString().slice(0, 10);
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

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setQueueError(null);
    try {
      const res = await apiClient.get(
        `/6hi/queue?subProcess=${apiSubProcess}&date=${date}&shift=${shift}&machine=${queueMachine}`,
      );
      const items: SixHiQueueCard[] = Array.isArray(res) ? res : (res.queue ?? []);
      if (!Array.isArray(res) && res.planDate) {
        useShiftStore.setState({
          shiftDate: res.planDate,
          shiftCode: (res.shiftCode ?? shift) as 'A' | 'B' | 'C',
        });
      }
      setQueue(items);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        logout();
        navigate('/login', { replace: true });
        return;
      }
      if (err instanceof ApiError) {
        setQueueError(err.message || `Queue unavailable (${err.status})`);
      } else {
        setQueueError(err instanceof Error ? err.message : 'Failed to load queue');
      }
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, [apiSubProcess, date, shift, queueMachine, logout, navigate]);

  useEffect(() => {
    loadQueue();
    const id = setInterval(loadQueue, 30000);
    return () => clearInterval(id);
  }, [loadQueue, queueRefreshToken]);

  useEffect(() => {
    const filtered = statusFilter === 'ALL' ? queue : queue.filter((c) => matchesFilter(c, statusFilter));
    if (filtered.length > 0 && !selectedBatch) {
      setSelectedBatch(filtered[0].batchNumber);
    } else if (filtered.length > 0 && !filtered.find((c) => c.batchNumber === selectedBatch)) {
      setSelectedBatch(filtered[0].batchNumber);
    } else if (filtered.length === 0) {
      setSelectedBatch(null);
    }
  }, [queue, statusFilter, selectedBatch]);

  const setTab = (id: string) => {
    setSearchParams({ tab: id, status: statusFilter });
    setSelectedBatch(null);
  };

  const setStatus = (id: StatusFilter) => {
    setSearchParams({ tab: activeTab, status: id });
    setSelectedBatch(null);
  };

  const filteredQueue = useMemo(
    () => queue.filter((c) => matchesFilter(c, statusFilter) && matchesSearch(c, search)),
    [queue, statusFilter, search],
  );

  const selected = filteredQueue.find((c) => c.batchNumber === selectedBatch)
    ?? queue.find((c) => c.batchNumber === selectedBatch)
    ?? null;

  const counts = useMemo(() => {
    const c: Record<string, number> = {
      ALL: queue.length,
      PENDING: 0,
      PREPARING: 0,
      IN_PROGRESS: 0,
      COMPLETED: 0,
    };
    for (const card of queue) {
      c[card.status] = (c[card.status] ?? 0) + 1;
    }
    return c;
  }, [queue]);

  const moveToProduction = (card: SixHiQueueCard) => {
    if (card.status === 'COMPLETED') return;
    openWorkspace(card.batchNumber);
  };

  const handleAllocate = async (machineCode: CrmMillCode) => {
    if (allocBatches.length === 0) return;
    await apiClient.post(
      `/6hi/orders/transfer-machines`,
      { machineCode, batchNumbers: allocBatches.map(b => b.batchNumber) },
    );
    setAllocOpen(false);
    setIsTransferMode(false);
    setSelectedForTransfer(new Set());
    useSixHiStore.getState().requestQueueRefresh();
    setAllocBatches([]);
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-secondary p-4 md:p-5 gap-3 overflow-hidden">
      <ZPageHeader
        title="Orders"
        subtitle={`${queueMachine} Mill · Shift ${shift} · ${date} · ${subProcessLabel}`}
        actions={
          <div className="flex gap-2 items-center">
            {canTransfer && (
              <button
                type="button"
                onClick={() => {
                  setIsTransferMode(!isTransferMode);
                  setSelectedForTransfer(new Set());
                }}
                className={[
                  "text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-md border transition-colors",
                  isTransferMode ? "bg-primary text-primary-foreground border-primary" : "bg-white text-muted-foreground border-border hover:bg-secondary"
                ].join(' ')}
              >
                {isTransferMode ? 'Cancel Transfer' : 'Bulk Transfer'}
              </button>
            )}
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
            placeholder="Search batch, mother coil, customer…"
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
            {loading && <p className="text-center text-muted-foreground py-12 text-base">Loading queue…</p>}
            {!loading && filteredQueue.length === 0 && (
              <div className="text-center py-12 px-6">
                <p className="text-muted-foreground text-base mb-2">No orders match this filter</p>
              </div>
            )}
            {!loading && filteredQueue.map((card) => {
              const isSelected = isTransferMode 
                ? selectedForTransfer.has(card.batchNumber)
                : card.batchNumber === selectedBatch;
              const isActive = machineActive?.batchNumber === card.batchNumber;
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
                      setSelectedBatch(card.batchNumber);
                    }
                  }}
                  className={[
                    'w-full text-left border-b border-border px-5 py-4 transition-colors min-h-[88px]',
                    'hover:bg-secondary active:bg-secondary',
                    isSelected && !isTransferMode ? 'bg-accent/10 border-l-4 border-l-primary' : 'border-l-4 border-l-transparent',
                    isSelected && isTransferMode ? 'bg-primary/5 border-l-4 border-l-primary' : '',
                    isActive ? 'ring-1 ring-inset ring-warning/30' : '',
                  ].join(' ')}
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="font-mono text-base font-bold text-foreground">{card.batchNumber}</span>
                    <SixHiStatusPill status={card.status} prepReady={card.prepReady} />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-sm text-muted-foreground">
                    <span className="truncate">{card.customer}</span>
                    <span className="font-mono truncate">{card.motherCoil}</span>
                    <span className="font-mono">
                      {card.inputThkMm}→{card.targetThkMm} mm
                      {card.finishThkMm != null && card.finishThkMm !== card.targetThkMm ? ` (fin ${card.finishThkMm})` : ''}
                      {card.rollingPassNo && card.rollingPassNo > 1 ? ` · P${card.rollingPassNo}` : ''}
                    </span>
                    <span className="font-mono">{card.weightMt} MT</span>
                    <span className="font-semibold text-foreground">
                      {card.machineAllocated === false
                        ? `Unassigned${card.suggestedMachineCode ? ` · hint ${card.suggestedMachineCode}` : ''}`
                        : card.machineCode}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <aside className="order-1 lg:order-2 w-full lg:w-[400px] shrink-0 min-h-0 lg:h-full flex flex-col overflow-hidden max-h-[min(480px,45vh)] lg:max-h-none">
          <SixHiBatchDetailPanel
            batch={selected}
            subProcessLabel={subProcessLabel}
            onOpen={() => selected && moveToProduction(selected)}
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
              setAllocBatches(queue.filter((c) => selectedForTransfer.has(c.batchNumber)));
              setAllocOpen(true);
            }}
          >
            Transfer…
          </button>
        </div>
      )}

      <MachineAllocationModal
        open={allocOpen}
        batches={allocBatches}
        onClose={() => { setAllocOpen(false); setAllocBatches([]); }}
        onConfirm={handleAllocate}
      />
    </div>
  );
}
