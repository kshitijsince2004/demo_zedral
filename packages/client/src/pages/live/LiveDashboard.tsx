import { useCallback, useEffect, useRef, useState } from 'react';
import type { LiveOrderDetail, LiveOrderRow } from '@m1/shared-validation';
import { CommandMetric } from '../../components/command/CommandMetric';
import { MachineStatusBoard } from '../../components/live/MachineStatusBoard';
import { OrderDetailModal } from '../../components/live/OrderDetailModal';
import { MachineDetailModal } from '../../components/live/MachineDetailModal';
import { ZBadge } from '../../components/primitives/ZBadge';
import { OrderIdentityDisplay } from '../../components/orders/OrderIdentityDisplay';
import { useLiveSnapshot, LIVE_POLL_MS } from '../../hooks/useLiveSnapshot';
import { liveService } from '../../lib/liveService';
import { jsonFingerprint } from '../../lib/silentRefresh';

function statusTone(status: string) {
  if (status === 'IN_PROGRESS' || status === 'PREPARING') return 'info' as const;
  if (status === 'STOPPAGE' || status === 'BREAKDOWN') return 'warning' as const;
  if (status === 'COMPLETED') return 'success' as const;
  return 'muted' as const;
}

export function LiveDashboard() {
  const { snapshot, loading, error } = useLiveSnapshot();
  const [orders, setOrders] = useState<LiveOrderRow[]>([]);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<LiveOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedMachineCode, setSelectedMachineCode] = useState<string | null>(null);
  const prevOrdersFpRef = useRef('');

  const loadOrders = useCallback(async () => {
    try {
      const ordersRes = await liveService.getOrders();
      const fingerprint = jsonFingerprint(ordersRes.orders);
      if (fingerprint !== prevOrdersFpRef.current) {
        prevOrdersFpRef.current = fingerprint;
        setOrders(ordersRes.orders);
      }
      setOrdersError(null);
    } catch (err: unknown) {
      setOrdersError((err as Error)?.message ?? 'Unable to load orders');
    }
  }, []);

  useEffect(() => {
    void loadOrders();
    const id = setInterval(() => void loadOrders(), LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [loadOrders]);

  const loadDetail = useCallback(async (batchNo: string) => {
    setSelectedBatch(batchNo);
    setDetailLoading(true);
    try {
      const data = await liveService.getOrderDetail(batchNo);
      setDetailData(data);
    } catch {
      // Ignore
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedBatch(null);
    setDetailData(null);
  }, []);

  if (loading && !snapshot) {
    return (
      <div className="flex flex-col gap-6 w-full">
        <div className="py-16 text-center text-muted-foreground text-sm">Loading Live Data…</div>
      </div>
    );
  }

  const kpis = snapshot?.kpis;
  const machines = (snapshot?.machines ?? []).filter((m) => m.status !== 'OFFLINE');
  const refreshedAt = snapshot?.refreshedAt
    ? new Date(snapshot.refreshedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="text-xs font-medium text-muted-foreground">Live — auto-refreshes every 8s</span>
        </div>
        {refreshedAt && (
          <span className="text-xs text-muted-foreground">Updated {refreshedAt}</span>
        )}
      </div>

      {(error || ordersError) && (
        <p className="text-sm text-destructive bg-destructive/10 p-4 rounded-xl">
          {error ?? ordersError}
        </p>
      )}

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
          <CommandMetric label="Running" value={String(kpis.runningMachines)} tone="success" />
          <CommandMetric label="Idle" value={String(kpis.idleMachines)} tone="muted" />
          <CommandMetric label="Stoppages" value={String(kpis.currentStoppages)} tone="warning" />
          <CommandMetric label="Active Orders" value={String(kpis.activeOrders)} tone="info" />
        </div>
      )}

      <div className="flex flex-col gap-8 w-full">
        <div className="space-y-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
            Machine Status Board
          </h2>
          <MachineStatusBoard
            machines={machines}
            onSelect={(code) => setSelectedMachineCode(code)}
          />
        </div>

        <div className="space-y-4">
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="bg-muted/30 px-5 py-3 border-b border-border/50">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Live Queue
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-muted/10 border-b border-border/50">
                    <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Order</th>
                    <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Status</th>
                    <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Process</th>
                    <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Machine</th>
                    <th className="px-5 py-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {orders.map((o) => (
                    <tr
                      key={o.batchNumber}
                      className="hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => loadDetail(o.batchNumber)}
                    >
                      <td className="px-5 py-3 align-middle">
                        <OrderIdentityDisplay order={o} size="sm" />
                        <div className="text-xs text-muted-foreground mt-0.5">{o.customer} · {o.weightMt} MT</div>
                      </td>
                      <td className="px-5 py-3 align-middle">
                        <ZBadge tone={statusTone(o.status)} label={o.status} />
                      </td>
                      <td className="px-5 py-3 align-middle">
                        <div className="text-xs font-bold text-foreground/80">{o.currentProcess}</div>
                      </td>
                      <td className="px-5 py-3 align-middle">
                        <div className="text-xs font-bold text-foreground">{o.machineCode}</div>
                        {o.operatorName && <div className="text-[11px] text-muted-foreground mt-0.5">{o.operatorName}</div>}
                      </td>
                      <td className="px-5 py-3 align-middle">
                        {o.completionPct != null && (
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-info" style={{ width: `${o.completionPct}%` }} />
                            </div>
                            <span className="font-mono text-xs font-medium text-muted-foreground">{o.completionPct}%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {orders.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-5 py-12 text-center text-sm text-muted-foreground font-medium">
                        No active orders
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <OrderDetailModal
        open={!!selectedBatch}
        onClose={closeDetail}
        order={detailData}
        loading={detailLoading}
      />

      <MachineDetailModal
        open={!!selectedMachineCode}
        onClose={() => setSelectedMachineCode(null)}
        machineCode={selectedMachineCode}
        machineData={machines.find((m) => m.machineCode === selectedMachineCode)}
      />
    </div>
  );
}
