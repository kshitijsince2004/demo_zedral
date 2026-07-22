import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, RefreshCw } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { transferOrderAssignment } from '../../lib/sync/sixHiWrites';
import { invalidateAfterWrite } from '../../lib/sync/invalidateAfterWrite';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { ZFilterPills } from '../../components/ui/operator/ZFilterPills';
import { FieldWrapper } from '../../components/forms/FieldWrapper';
import { formatPlantDateTime } from '../../lib/dateFormat';
import { useAuthStore } from '../../lib/authStore';

type AssignmentOrder = {
  batchNumber: string;
  planDate: string;
  shiftCode: string;
  customer: string;
  product: string;
  quantityMt: number;
  currentMachine: string | null;
  suggestedMachine?: string;
  subProcess: 'ROLLING' | 'SKIN_PASS';
  status: string;
  machineAllocated: boolean;
};

type AssignmentMachine = {
  code: string;
  name?: string;
  rolling: boolean;
  skinPass: boolean;
  queueCount: number;
  activeBatch: string | null;
};

type TransferAudit = {
  transferId: string;
  batchNumber: string;
  fromMachine: string;
  toMachine: string;
  subProcess: string;
  reason?: string;
  assignedBy: string;
  transferredAt: string;
  transferType?: string;
};

type AssignmentBoard = {
  orders: AssignmentOrder[];
  machines: AssignmentMachine[];
  recentTransfers: TransferAudit[];
};

const FILTER_OPTIONS = [
  { id: 'ALL' as const, label: 'All Orders' },
  { id: 'ROLLING' as const, label: 'Rolling' },
  { id: 'SKIN_PASS' as const, label: 'Skin Pass' },
];

const NON_TRANSFERABLE = new Set(['IN_PROGRESS', 'STOPPAGE', 'COMPLETED', 'REJECTED']);

function canTransferOrder(order: AssignmentOrder): boolean {
  return !NON_TRANSFERABLE.has(order.status);
}

export function OrderAssignmentPanel() {
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const [board, setBoard] = useState<AssignmentBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isFirstLoad = useRef(true);
  const prevBoardRef = useRef<string>('');
  const [selectedBatches, setSelectedBatches] = useState<Set<string>>(new Set());
  const [targetMachine, setTargetMachine] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'ROLLING' | 'SKIN_PASS'>('ALL');
  const [bulkMode, setBulkMode] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await apiClient.get<AssignmentBoard>('/6hi/order-assignment');
      const fingerprint = JSON.stringify(data);
      if (!silent || fingerprint !== prevBoardRef.current) {
        prevBoardRef.current = fingerprint;
        setBoard(data);
      }
      if (!silent) isFirstLoad.current = false;
    } catch (err) {
      if (!silent) setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isFirstLoad.current = true;
    prevBoardRef.current = '';
    void load(false);
    const id = setInterval(() => void load(true), 15_000);
    return () => clearInterval(id);
  }, [load]);

  const filteredOrders = useMemo(() => {
    if (!board) return [];
    let list = board.orders;
    if (machineAccess.length > 0) {
      // Show unassigned orders + orders assigned to our machines
      list = list.filter((o) => !o.currentMachine || machineAccess.includes(o.currentMachine));
    }
    if (filter === 'ALL') return list;
    return list.filter((o) => o.subProcess === filter);
  }, [board, filter, machineAccess]);

  const transferableOrders = useMemo(
    () => filteredOrders.filter(canTransferOrder),
    [filteredOrders],
  );

  const selectedOrders = useMemo(
    () => filteredOrders.filter((o) => selectedBatches.has(o.batchNumber)),
    [filteredOrders, selectedBatches],
  );

  const primaryOrder = selectedOrders.length === 1 ? selectedOrders[0] : selectedOrders[0] ?? null;

  const destinationOptions = useMemo(() => {
    if (!board || selectedOrders.length === 0) return [] as string[];
    const subProcesses = new Set(selectedOrders.map((o) => o.subProcess));
    let machines = board.machines;
    if (machineAccess.length > 0) {
      machines = machines.filter((m) => machineAccess.includes(m.code));
    }
    
    if (subProcesses.size > 1) {
      return machines
        .filter((m) => m.rolling && m.skinPass)
        .map((m) => m.code);
    }
    const sp = selectedOrders[0].subProcess;
    return machines
      .filter((m) => (sp === 'ROLLING' ? m.rolling : m.skinPass))
      .map((m) => m.code);
  }, [board, selectedOrders, machineAccess]);

  useEffect(() => {
    if (destinationOptions.length === 0) {
      setTargetMachine('');
      return;
    }
    if (!destinationOptions.includes(targetMachine)) {
      setTargetMachine(destinationOptions[0]);
    }
  }, [destinationOptions, targetMachine]);

  const toggleBatch = (batchNumber: string) => {
    setSelectedBatches((prev) => {
      const next = new Set(prev);
      if (next.has(batchNumber)) next.delete(batchNumber);
      else next.add(batchNumber);
      return next;
    });
  };

  const selectAllTransferable = () => {
    setSelectedBatches(new Set(transferableOrders.map((o) => o.batchNumber)));
  };

  const canSubmit = selectedOrders.length > 0
    && targetMachine
    && selectedOrders.every(canTransferOrder)
    && selectedOrders.some((o) => o.currentMachine !== targetMachine || !o.machineAllocated);

  const transfer = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = await transferOrderAssignment({
        batchNumbers: selectedOrders.map((o) => o.batchNumber),
        machineCode: targetMachine,
        reason: reason.trim() || undefined,
      });
      const failed = res.data?.results?.filter((r) => !r.ok) ?? [];
      if (failed.length > 0) {
        setActionError(failed.map((f) => `${f.batchNumber}: ${f.error}`).join('; '));
      }
      invalidateAfterWrite();
      setReason('');
      setSelectedBatches(new Set());
      setBulkMode(false);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Transfer failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 min-h-0 flex-1">
      <div className="shrink-0">
        <p className="text-sm text-muted-foreground">
          All importable PPC orders across every plan date and shift. Assign or bulk-transfer using live machine registry data.
        </p>
      </div>

      <div className="shrink-0 flex flex-wrap gap-2 items-center">
        <ZFilterPills options={FILTER_OPTIONS} activeId={filter} onChange={setFilter} />
        <ZButton
          variant={bulkMode ? 'accent' : 'secondary'}
          size="sm"
          onClick={() => { setBulkMode(!bulkMode); setSelectedBatches(new Set()); }}
        >
          {bulkMode ? 'Exit Bulk Mode' : 'Bulk Transfer'}
        </ZButton>
        <ZButton
          variant="secondary"
          size="sm"
          onClick={() => {
            setSyncing(true);
            void load(true).finally(() => setSyncing(false));
          }}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin text-primary' : ''}`} />
          Refresh
        </ZButton>
        {bulkMode && (
          <ZButton variant="secondary" size="sm" onClick={selectAllTransferable}>
            Select All Transferable
          </ZButton>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 min-h-0 flex-1">
        <section className="xl:col-span-2 bg-white border border-border rounded-2xl shadow-sm flex flex-col min-h-[320px] overflow-hidden">
          <div className="shrink-0 px-5 py-3 border-b border-border flex justify-between items-center">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Available Orders ({filteredOrders.length})
            </h2>
            {bulkMode && selectedBatches.size > 0 && (
              <span className="text-xs font-bold text-primary">{selectedBatches.size} selected</span>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            {loading && !board && (
              <p className="text-center text-muted-foreground py-12 text-sm">Loading orders…</p>
            )}
            {!loading && filteredOrders.length === 0 && (
              <p className="text-center text-muted-foreground py-12 text-sm">No importable orders in the PPC plan</p>
            )}
            {filteredOrders.map((order) => {
              const isSelected = selectedBatches.has(order.batchNumber);
              const machineLabel = order.machineAllocated
                ? order.currentMachine
                : order.suggestedMachine
                  ? `${order.suggestedMachine} (unassigned)`
                  : 'Unassigned';
              return (
                <div
                  key={order.batchNumber}
                  className={[
                    'w-full text-left px-5 py-4 border-b border-border transition-colors flex gap-3 min-h-[88px]',
                    isSelected ? 'bg-accent/10 border-l-4 border-l-primary' : 'border-l-4 border-l-transparent hover:bg-secondary active:bg-secondary',
                  ].join(' ')}
                >
                  {bulkMode && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!canTransferOrder(order)}
                      onChange={() => toggleBatch(order.batchNumber)}
                      className="mt-1 h-4 w-4"
                    />
                  )}
                  <button
                    type="button"
                    className="flex-1 text-left"
                    onClick={() => {
                      if (bulkMode) {
                        if (canTransferOrder(order)) toggleBatch(order.batchNumber);
                      } else {
                        setSelectedBatches(new Set([order.batchNumber]));
                      }
                    }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-mono font-bold text-sm">{order.batchNumber}</span>
                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                        {order.subProcess === 'ROLLING' ? 'Rolling' : 'Skin Pass'}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="truncate">{order.customer}</span>
                      <span className="truncate">{order.product}</span>
                      <span>{order.quantityMt} MT</span>
                      <span className="font-semibold text-foreground">{machineLabel}</span>
                      <span className="font-mono col-span-2 md:col-span-4">
                        Plan {order.planDate} · Shift {order.shiftCode}
                      </span>
                    </div>
                    {!canTransferOrder(order) && (
                      <p className="text-xs text-warning font-medium mt-1">
                        {order.status} — cannot reassign
                      </p>
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="bg-white border border-border rounded-2xl shadow-sm p-4 space-y-4">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {selectedOrders.length > 1 ? `Bulk Transfer (${selectedOrders.length})` : 'Assign / Transfer'}
            </h2>
            {selectedOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">Select order(s) from the list</p>
            ) : (
              <>
                {selectedOrders.length === 1 && primaryOrder && (
                  <div className="space-y-2 text-sm">
                    <p><span className="text-muted-foreground">Order:</span> <span className="font-mono font-bold">{primaryOrder.batchNumber}</span></p>
                    <p><span className="text-muted-foreground">Current:</span> <span className="font-semibold">{primaryOrder.currentMachine ?? 'Unassigned'}</span></p>
                  </div>
                )}
                {selectedOrders.length > 1 && (
                  <p className="text-sm text-muted-foreground">
                    Moving {selectedOrders.length} orders to the selected destination.
                  </p>
                )}

                <FieldWrapper label="Destination Machine">
                  {destinationOptions.length === 0 ? (
                    <p className="text-sm text-destructive">No compatible destination for mixed selection</p>
                  ) : (
                    <div className={[
                      'grid gap-2',
                      destinationOptions.length >= 3 ? 'grid-cols-3' : 'grid-cols-2',
                    ].join(' ')}>
                      {destinationOptions.map((mill) => (
                        <button
                          key={mill}
                          type="button"
                          onClick={() => setTargetMachine(mill)}
                          className={[
                            'min-h-12 rounded-xl border-2 font-bold text-sm',
                            targetMachine === mill ? 'border-primary bg-primary/10 text-primary' : 'border-border',
                          ].join(' ')}
                        >
                          {mill}
                        </button>
                      ))}
                    </div>
                  )}
                </FieldWrapper>

                <FieldWrapper label="Reason (optional)">
                  <ZInput
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Load balancing, machine breakdown…"
                  />
                </FieldWrapper>

                {actionError && <p className="text-sm text-destructive">{actionError}</p>}

                <ZButton
                  variant="accent"
                  fullWidth
                  disabled={!canSubmit || busy}
                  onClick={() => void transfer()}
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  {busy
                    ? 'Transferring…'
                    : selectedOrders.length > 1
                      ? `Bulk Transfer (${selectedOrders.length})`
                      : primaryOrder?.machineAllocated
                        ? 'Transfer Order'
                        : 'Assign Order'}
                </ZButton>
              </>
            )}
          </section>

          <section className="bg-white border border-border rounded-2xl shadow-sm p-4">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Available Machines</h2>
            <div className="space-y-2">
              {(board?.machines ?? []).map((m) => (
                <div key={m.code} className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-3 py-2.5 text-sm">
                  <div>
                    <p className="font-bold">{m.code}{m.name ? ` · ${m.name}` : ''}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                      {[m.rolling && 'Rolling', m.skinPass && 'Skin Pass'].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="font-semibold">{m.queueCount} queued</p>
                    {m.activeBatch && <p className="text-warning font-mono">{m.activeBatch}</p>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {board && board.recentTransfers.length > 0 && (
        <section className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Assignment Audit Log</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border bg-muted/30">
                  <th className="px-4 py-2 font-bold">Order</th>
                  <th className="px-4 py-2 font-bold">From</th>
                  <th className="px-4 py-2 font-bold">To</th>
                  <th className="px-4 py-2 font-bold">Type</th>
                  <th className="px-4 py-2 font-bold">Assigned By</th>
                  <th className="px-4 py-2 font-bold">Timestamp</th>
                  <th className="px-4 py-2 font-bold">Reason</th>
                </tr>
              </thead>
              <tbody>
                {board.recentTransfers.map((t) => (
                  <tr key={t.transferId} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 font-mono font-bold">{t.batchNumber}</td>
                    <td className="px-4 py-2.5">{t.fromMachine}</td>
                    <td className="px-4 py-2.5">{t.toMachine}</td>
                    <td className="px-4 py-2.5">{t.transferType ?? 'SINGLE'}</td>
                    <td className="px-4 py-2.5">{t.assignedBy}</td>
                    <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                      {formatPlantDateTime(t.transferredAt)}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{t.reason ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
