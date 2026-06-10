import { useEffect, useState } from 'react';
import type { MachineCommandCenterData, MachineStatusCard } from '@m1/shared-validation';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { Activity, AlertTriangle, Power, ShieldAlert, X } from 'lucide-react';
import { liveService } from '../../lib/liveService';

interface MachineDetailModalProps {
  open: boolean;
  onClose: () => void;
  machineCode: string | null;
  machineData?: MachineStatusCard;
}

function statusCardClass(status: string) {
  switch (status) {
    case 'RUNNING': return 'bg-[#ECFDF5] border-[#10B981]/30 text-[#10B981]';
    case 'STOPPAGE': return 'bg-warning/10 border-warning/30 text-warning';
    case 'BREAKDOWN': return 'bg-destructive/10 border-destructive/30 text-destructive';
    case 'MAINTENANCE': return 'bg-info/10 border-info/30 text-info';
    default: return 'bg-slate-50 border-slate-200 text-slate-600 dark:bg-slate-800/50 dark:border-slate-700';
  }
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-white border border-border rounded-xl p-4 shadow-sm">
      <span className={`text-[10px] font-bold uppercase tracking-widest block mb-1 ${accent ?? 'text-muted-foreground'}`}>
        {label}
      </span>
      <div className="flex justify-between items-baseline gap-2">
        <span className="font-mono text-xl font-bold text-foreground">{value}</span>
        {sub && <span className={`font-bold text-sm ${accent ?? 'text-muted-foreground'}`}>{sub}</span>}
      </div>
    </div>
  );
}

export function MachineDetailModal({ open, onClose, machineCode, machineData }: MachineDetailModalProps) {
  const [detail, setDetail] = useState<MachineCommandCenterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = detail?.currentStatus ?? machineData?.status ?? 'IDLE';
  const stateSince = machineData?.stateSinceAt ?? detail?.currentOrder?.runningSinceAt;
  const { formatted: liveDuration } = useLiveTimer(stateSince, status === 'RUNNING' || status === 'STOPPAGE' || status === 'BREAKDOWN');

  useEffect(() => {
    if (!open || !machineCode) {
      setDetail(null);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    void liveService.getMachineState(machineCode)
      .then((data) => { if (active) setDetail(data); })
      .catch((err) => { if (active) setError((err as Error).message ?? 'Failed to load machine data'); })
      .finally(() => { if (active) setLoading(false); });

    const id = setInterval(() => {
      void liveService.getMachineState(machineCode)
        .then((data) => { if (active) setDetail(data); })
        .catch(() => {});
    }, 12_000);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [open, machineCode]);

  if (!open || !machineCode) return null;

  const machineName = detail?.machineName ?? machineData?.machineName ?? machineCode;
  const currentOrder = detail?.currentOrder?.batchNumber ?? machineData?.currentOrder;
  const operator = detail?.currentOperator ?? machineData?.currentOperator;
  const shift = detail?.shiftCode ?? machineData?.shiftCode;
  const utilization = detail?.utilization;
  const timeline = detail?.timeline ?? [];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="fixed inset-y-4 right-4 z-50 w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between bg-muted/20">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-info animate-pulse" />
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Machine Drill-down</h2>
            </div>
            <h1 className="text-2xl font-bold text-foreground">{machineName}</h1>
            <p className="text-xs font-mono text-muted-foreground mt-0.5">{machineCode}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 hover:bg-muted rounded-full transition-colors">
            <X className="w-6 h-6 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto hide-scrollbar p-6 space-y-6">
          {loading && !detail && (
            <p className="text-sm text-muted-foreground text-center py-8">Loading live machine data…</p>
          )}
          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">{error}</p>
          )}

          <section className={`rounded-xl p-5 border ${statusCardClass(status)}`}>
            <div className="flex justify-between items-start mb-4">
              <span className="text-2xl font-bold uppercase tracking-wider">{status}</span>
              {status === 'RUNNING' && <Activity className="w-7 h-7 opacity-60" />}
              {status === 'IDLE' && <Power className="w-7 h-7 opacity-60" />}
              {status === 'STOPPAGE' && <AlertTriangle className="w-7 h-7 opacity-60 animate-pulse" />}
              {status === 'BREAKDOWN' && <ShieldAlert className="w-7 h-7 opacity-60 animate-pulse" />}
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-70 block mb-1">
                  {status === 'RUNNING' ? 'Runtime' : status === 'IDLE' ? 'Idle For' : 'Duration'}
                </span>
                <span className="font-mono text-xl font-bold">{liveDuration || '—'}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-70 block mb-1">Production Status</span>
                <span className="font-bold">{currentOrder ? 'Active Order' : 'No Active Order'}</span>
              </div>
              {currentOrder && (
                <div className="col-span-2 bg-white/60 dark:bg-black/20 rounded-lg p-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest opacity-70 block mb-1">Current Order</span>
                  <span className="font-mono text-lg font-bold">{currentOrder}</span>
                  {detail?.currentOrder?.customer && (
                    <p className="text-xs mt-1 opacity-80">{detail.currentOrder.customer} · {detail.currentOrder.weightMt} MT</p>
                  )}
                </div>
              )}
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-70 block mb-1">Operator</span>
                <span className="font-bold">{operator || '—'}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest opacity-70 block mb-1">Shift</span>
                <span className="font-bold">{shift || '—'}</span>
              </div>
              {detail?.activeStoppage && (
                <div className="col-span-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest opacity-70 block mb-1">Stoppage Reason</span>
                  <span className="font-bold">{detail.activeStoppage.reason}</span>
                </div>
              )}
            </div>
          </section>

          {utilization && (
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Last 24 Hours Summary</h3>
              <div className="grid grid-cols-2 gap-4">
                <SummaryCard label="Runtime" value={`${Math.round(utilization.runningMin)}m`} sub={`${utilization.runningPct}%`} accent="text-[#10B981]" />
                <SummaryCard label="Idle Time" value={`${Math.round(utilization.idleMin)}m`} sub={`${utilization.idlePct}%`} />
                <SummaryCard label="Stoppages" value={`${Math.round(utilization.stoppageMin)}m`} sub={`${utilization.stoppageCount} incidents`} accent="text-warning" />
                <SummaryCard label="Maintenance" value={`${Math.round(utilization.maintenanceMin)}m`} sub={`${utilization.maintenancePct}%`} accent="text-info" />
              </div>
            </section>
          )}

          {detail?.nextOrder && (
            <section className="bg-white border border-border rounded-xl p-4 shadow-sm">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Next In Queue</h3>
              <p className="font-mono font-bold">{detail.nextOrder.batchNumber}</p>
              <p className="text-xs text-muted-foreground mt-1">{detail.nextOrder.customer} · Position #{detail.nextOrder.queuePosition}</p>
            </section>
          )}

          {timeline.length > 0 && (
            <section>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Event History</h3>
              <div className="border border-border rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left text-sm">
                  <thead className="bg-muted/30 border-b border-border text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Event</th>
                      <th className="px-4 py-3">Start</th>
                      <th className="px-4 py-3">Duration</th>
                      <th className="px-4 py-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {timeline.slice(0, 20).map((evt) => (
                      <tr key={evt.eventId} className="hover:bg-muted/10">
                        <td className="px-4 py-3">
                          <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded border bg-muted/30 text-foreground">
                            {evt.eventType.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground text-xs">
                          {new Date(evt.occurredAt).toLocaleTimeString()}
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-xs">
                          {evt.durationMin != null ? `${Math.round(evt.durationMin)}m` : '—'}
                        </td>
                        <td className="px-4 py-3 text-xs">{evt.reason ?? evt.batchNumber ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
