import { useCallback, useEffect, useState } from 'react';
import type { LiveOrderRow, LiveSnapshot } from '@m1/shared-validation';
// Removed Shell import
import { CommandMetric } from '../../components/command/CommandMetric';
import { MachineStatusBoard } from '../../components/live/MachineStatusBoard';
import { OrderDetailModal } from '../../components/live/OrderDetailModal';
import { MachineDetailModal } from '../../components/live/MachineDetailModal';
import { ZBadge } from '../../components/primitives/ZBadge';
import { liveService } from '../../lib/liveService';

const POLL_MS = 12_000;

function statusTone(status: string) {
  if (status === 'IN_PROGRESS' || status === 'PREPARING') return 'info' as const;
  if (status === 'STOPPAGE' || status === 'BREAKDOWN') return 'warning' as const;
  if (status === 'COMPLETED') return 'success' as const;
  return 'muted' as const;
}

export function LiveDashboard() {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [orders, setOrders] = useState<LiveOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Machine Detail Modal State
  const [selectedMachineCode, setSelectedMachineCode] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [snap, ordersRes] = await Promise.all([
        liveService.getSnapshot(),
        liveService.getOrders(),
      ]);
      setSnapshot(snap);
      setOrders(ordersRes.orders);
      setError(null);
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Unable to load live dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

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
  const machines = snapshot?.machines ?? [];

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto">
      {error && <p className="text-sm text-destructive bg-destructive/10 p-4 rounded-xl mb-6">{error}</p>}

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Running', value: kpis.runningMachines, color: 'text-[#10B981]' },
            { label: 'Idle', value: kpis.idleMachines, color: 'text-slate-500' },
            { label: 'Stoppages', value: kpis.currentStoppages, color: 'text-amber-500' },
            { label: 'Active Orders', value: kpis.activeOrders, color: 'text-blue-500' },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm flex flex-col">
              <div className="bg-muted/30 px-4 py-2 border-b border-border/50">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{kpi.label}</span>
              </div>
              <div className="px-4 py-4">
                <span className={`font-mono text-3xl font-bold ${kpi.color}`}>{kpi.value}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-8 w-full">
        
        {/* Machine Line Status Board */}
        <div className="space-y-4">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">
            Line Status Board
          </h2>
          <MachineStatusBoard 
            machines={machines} 
            onSelect={(code) => setSelectedMachineCode(code)} 
          />
        </div>

        {/* Live Orders */}
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="bg-muted/30 px-5 py-3 border-b border-border/50 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
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
                        <div className="font-mono text-sm font-bold text-foreground">{o.batchNumber}</div>
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
        machineData={machines.find(m => m.machineCode === selectedMachineCode)}
      />
    </div>
  );
}
