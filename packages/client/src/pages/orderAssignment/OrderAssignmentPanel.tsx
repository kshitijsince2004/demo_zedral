import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, RefreshCw } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { useShiftStore } from '../../store/shiftStore';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { FieldWrapper } from '../../components/forms/FieldWrapper';

type AssignmentOrder = {
  batchNumber: string;
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
  planDate: string;
  shiftCode: string;
  orders: AssignmentOrder[];
  machines: AssignmentMachine[];
  recentTransfers: TransferAudit[];
};

const NON_TRANSFERABLE = new Set(['IN_PROGRESS', 'STOPPAGE', 'COMPLETED', 'REJECTED']);

function canTransferOrder(order: AssignmentOrder): boolean {
  return !NON_TRANSFERABLE.has(order.status);
}

export function OrderAssignmentPanel() {
  const { shiftDate, shiftCode } = useShiftStore();
  const date = shiftDate || new Date().toISOString().slice(0, 10);
  const shift = shiftCode || 'A';

  const [board, setBoard] = useState<AssignmentBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBatches, setSelectedBatches] = useState<Set<string>>(new Set());
  const [targetMachine, setTargetMachine] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'ROLLING' | 'SKIN_PASS'>('ALL');
  const [bulkMode, setBulkMode] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<AssignmentBoard>(
        `/6hi/order-assignment?date=${encodeURIComponent(date)}&shift=${encodeURIComponent(shift)}`,
      );
      setBoard(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [date, shift]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredOrders = useMemo(() => {
    if (!board) return [];
    if (filter === 'ALL') return board.orders;
    return board.orders.filter((o) => o.subProcess === filter);
  }, [board, filter]);

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
    if (subProcesses.size > 1) {
      return board.machines
        .filter((m) => m.rolling && m.skinPass)
        .map((m) => m.code);
    }
    const sp = selectedOrders[0].subProcess;
    return board.machines
      .filter((m) => (sp === 'ROLLING' ? m.rolling : m.skinPass))
      .map((m) => m.code);
  }, [board, selectedOrders]);

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
      const res = await apiClient.post<{ ok: boolean; results?: { batchNumber: string; ok: boolean; error?: string }[] }>(
        '/6hi/order-assignment/transfer',
        {
          batchNumbers: selectedOrders.map((o) => o.batchNumber),
          machineCode: targetMachine,
          reason: reason.trim() || undefined,
        },
      );
      const failed = res.results?.filter((r) => !r.ok) ?? [];
      if (failed.length > 0) {
        setActionError(failed.map((f) => `${f.batchNumber}: ${f.error}`).join('; '));
      }
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
    <div className="flex flex-col gap-4 min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Plan {board?.planDate ?? date} · Shift {board?.shiftCode ?? shift}
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            Assign or bulk-transfer orders using live machine registry data.
          </p>
        </div>
        <div className="flex gap-2">
          <ZButton
            variant={bulkMode ? 'accent' : 'secondary'}
            size="sm"
            onClick={() => { setBulkMode(!bulkMode); setSelectedBatches(new Set()); }}
          >
            {bulkMode ? 'Exit Bulk Mode' : 'Bulk Transfer'}
          </ZButton>
          <ZButton variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </ZButton>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(['ALL', 'ROLLING', 'SKIN_PASS'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={[
              'px-3 py-1.5 rounded-lg border text-xs font-bold uppercase tracking-wide',
              filter === id ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-card',
            ].join(' ')}
          >
            {id === 'ALL' ? 'All Orders' : id === 'ROLLING' ? 'Rolling' : 'Skin Pass'}
          </button>
        ))}
        {bulkMode && (
          <button
            type="button"
            onClick={selectAllTransferable}
            className="px-3 py-1.5 rounded-lg border border-border text-xs font-bold uppercase tracking-wide bg-card hover:bg-secondary"
          >
            Select All Transferable
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 min-h-0 flex-1">
        <section className="xl:col-span-2 bg-card border border-border rounded-2xl flex flex-col min-h-[320px] overflow-hidden">
          <div className="shrink-0 px-4 py-3 border-b border-border flex justify-between items-center">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
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
              <p className="text-center text-muted-foreground py-12 text-sm">No orders for this shift</p>
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
                    'w-full text-left px-4 py-3 border-b border-border transition-colors flex gap-3',
                    isSelected ? 'bg-primary/5 border-l-4 border-l-primary' : 'border-l-4 border-l-transparent hover:bg-secondary/40',
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
          <section className="bg-card border border-border rounded-2xl p-4 space-y-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
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

          <section className="bg-card border border-border rounded-2xl p-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground mb-3">Available Machines</h2>
            <div className="space-y-2">
              {(board?.machines ?? []).map((m) => (
                <div key={m.code} className="flex items-center justify-between rounded-xl border border-border px-3 py-2 text-sm">
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
        <section className="bg-card border border-border rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Assignment Audit Log</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
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
                      {new Date(t.transferredAt).toLocaleString()}
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
