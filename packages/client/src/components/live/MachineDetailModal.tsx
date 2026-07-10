import { useEffect, useState } from 'react';
import type { MachineCommandCenterData, MachineStatusCard } from '@m1/shared-validation';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { LIVE_POLL_MS } from '../../hooks/useLiveSnapshot';
import { Activity, AlertTriangle, Power, ShieldAlert, X } from 'lucide-react';
import { formatOrderStatusLabel } from '../../lib/orderLabels';
import { liveService } from '../../lib/liveService';

interface MachineDetailModalProps {
  open: boolean;
  onClose: () => void;
  machineCode: string | null;
  machineData?: MachineStatusCard;
  processFilter?: 'ALL' | 'ROLLING' | 'SKIN_PASS';
}

function matchesProcess(subProcess: string | undefined, filter: 'ALL' | 'ROLLING' | 'SKIN_PASS'): boolean {
  if (filter === 'ALL') return true;
  return subProcess === filter;
}

function processLabel(subProcess?: string): string {
  if (subProcess === 'SKIN_PASS') return 'Skin Pass';
  if (subProcess === 'ROLLING') return 'Cold Rolling';
  return subProcess ?? '';
}

function statusCardClass(status: string) {
  switch (status) {
    case 'RUNNING': return 'bg-success/10 border-success/30 text-success';
    case 'STOPPAGE': return 'bg-warning/10 border-warning/30 text-warning';
    case 'BREAKDOWN': return 'bg-destructive/10 border-destructive/30 text-destructive';
    case 'MAINTENANCE': return 'bg-info/10 border-info/30 text-info';
    default: return 'bg-muted border-border text-muted-foreground';
  }
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="bg-card text-card-foreground border border-border rounded-xl shadow p-5 flex flex-col">
      <span className={`text-sm font-medium mb-1 ${accent ?? 'text-muted-foreground'}`}>
        {label}
      </span>
      <div className="flex justify-between items-baseline gap-2 mt-auto">
        <span className="font-mono text-2xl font-bold text-foreground">{value}</span>
        {sub && <span className={`font-medium text-xs ${accent ?? 'text-muted-foreground'}`}>{sub}</span>}
      </div>
    </div>
  );
}

export function MachineDetailModal({ open, onClose, machineCode, machineData, processFilter = 'ALL' }: MachineDetailModalProps) {
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
    }, LIVE_POLL_MS);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [open, machineCode]);

  if (!open || !machineCode) return null;

  const machineName = detail?.machineName ?? machineData?.machineName ?? machineCode;
  const showCurrentOrder = !detail?.currentOrder
    || matchesProcess(detail.currentOrder.subProcess, processFilter);
  const currentOrder = showCurrentOrder
    ? (detail?.currentOrder?.batchNumber ?? machineData?.currentOrder)
    : undefined;
  const operator = detail?.currentOperator ?? machineData?.currentOperator;
  const shift = detail?.shiftCode ?? machineData?.shiftCode;
  const utilization = detail?.utilization;
  const timeline = detail?.timeline ?? [];
  const stoppageReason = machineData?.activeStoppageReason ?? detail?.activeStoppage?.reason;
  const operatorRemarks = detail?.activeStoppage?.remarks ?? machineData?.operatorRemarks;
  const activeOrders = (detail?.activeOrders?.length ?? 0) > 1
    ? detail!.activeOrders!
    : (machineData?.activeOrderCount ?? 0) > 1 && machineData?.activeOrders
      ? machineData.activeOrders
      : null;
  const activeOrderCount = activeOrders?.length ?? machineData?.activeOrderCount ?? 0;
  const filteredQueue = (detail?.orderQueue ?? []).filter((o) => matchesProcess(o.subProcess, processFilter));
  const filteredCompleted = (detail?.completedOrders ?? []).filter((o) => matchesProcess(o.subProcess, processFilter));

  function thicknessLine(o: { subProcess?: string; inputThkMm?: number; targetThkMm?: number }): string | null {
    if (o.targetThkMm == null) return null;
    if (o.subProcess === 'SKIN_PASS') {
      return `Pre ${o.inputThkMm ?? '—'} → Target ${o.targetThkMm} mm`;
    }
    return `Target ${o.targetThkMm} mm`;
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="fixed inset-y-4 right-4 z-50 w-full max-w-2xl bg-card text-card-foreground border border-border rounded-xl shadow-2xl overflow-hidden flex flex-col">
        <div className="p-6 border-b border-border/50 flex items-center justify-between bg-muted/10">
          <div className="flex flex-col space-y-1.5">
            <div className="mb-1">
              <h2 className="font-semibold text-muted-foreground text-sm uppercase tracking-wide">Machine Drill-down</h2>
            </div>
            <h1 className="text-2xl font-bold leading-none tracking-tight text-foreground">{machineName}</h1>
            <p className="text-sm font-mono text-muted-foreground">{machineCode}</p>
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
                <span className="text-xs font-semibold text-muted-foreground block mb-1">
                  {status === 'RUNNING' ? 'Runtime' : status === 'IDLE' ? 'Idle For' : 'Duration'}
                </span>
                <span className="font-mono text-xl font-bold">{liveDuration || '—'}</span>
              </div>
              <div>
                <span className="text-xs font-semibold text-muted-foreground block mb-1">Production Status</span>
                <span className="font-bold">
                  {activeOrderCount > 1 ? `${activeOrderCount} Orders Running` : currentOrder ? 'Active Order' : 'No Active Order'}
                </span>
              </div>
              {activeOrderCount > 1 && activeOrders ? (
                <div className="col-span-2 bg-background border border-border/40 shadow-sm rounded-lg p-4 mt-2 mb-2 space-y-2">
                  <span className="text-xs font-semibold text-muted-foreground block">
                    {activeOrderCount} Orders Running
                  </span>
                  {activeOrders.map((o) => {
                    const rich = 'subProcess' in o ? o : detail?.activeOrders?.find((d) => d.batchNumber === o.batchNumber);
                    const thk = rich && 'targetThkMm' in rich ? thicknessLine(rich) : null;
                    return (
                      <div key={o.batchNumber} className="rounded-lg border border-border/60 px-3 py-2">
                        <p className="font-mono text-sm font-bold">{o.coilNo ?? o.batchNumber}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {o.customer ?? '—'} · {formatOrderStatusLabel(o.status)}
                          {o.weightMt != null ? ` · ${o.weightMt} MT` : ''}
                        </p>
                        {thk && <p className="text-[11px] font-mono text-muted-foreground mt-1">{thk}</p>}
                        {'runtimeMin' in o && o.runtimeMin != null && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">Runtime {o.runtimeMin} min</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : currentOrder && (
                <div className="col-span-2 bg-background border border-border/40 shadow-sm rounded-lg p-4 mt-2 mb-2">
                  <span className="text-xs font-semibold text-muted-foreground block mb-1">Current Order</span>
                  <span className="font-mono text-lg font-bold">{currentOrder}</span>
                  {detail?.currentOrder?.customer && (
                    <p className="text-sm mt-1 text-muted-foreground">{detail.currentOrder.customer} · {detail.currentOrder.weightMt} MT</p>
                  )}
                </div>
              )}
              <div>
                <span className="text-xs font-semibold text-muted-foreground block mb-1">Operator</span>
                <span className="font-bold">{operator || '—'}</span>
              </div>
              <div>
                <span className="text-xs font-semibold text-muted-foreground block mb-1">Shift</span>
                <span className="font-bold">{shift || '—'}</span>
              </div>
              {(detail?.activeStoppage || stoppageReason) && (
                <div className="col-span-2 mt-2 space-y-2">
                  <div>
                    <span className="text-xs font-semibold text-muted-foreground block mb-1">Stoppage Cause</span>
                    <span className="font-bold">{stoppageReason ?? detail?.activeStoppage?.reason ?? '—'}</span>
                  </div>
                  {operatorRemarks && (
                    <div>
                      <span className="text-xs font-semibold text-muted-foreground block mb-1">Operator Remarks</span>
                      <span className="text-sm">{operatorRemarks}</span>
                    </div>
                  )}
                </div>
              )}
              {!detail?.activeStoppage && !stoppageReason && operatorRemarks && (
                <div className="col-span-2 mt-2">
                  <span className="text-xs font-semibold text-muted-foreground block mb-1">Operator Remarks</span>
                  <span className="text-sm">{operatorRemarks}</span>
                </div>
              )}
            </div>
          </section>

          {utilization && (
            <section>
              <h3 className="text-sm font-semibold tracking-tight text-foreground mb-1">Runtime Utilization (24h)</h3>
              <p className="text-sm text-muted-foreground mb-4">Running minutes as a share of the 24-hour event window</p>
              <div className="grid grid-cols-2 gap-4">
                <SummaryCard label="Runtime" value={`${Math.round(utilization.runningMin)}m`} sub={`${utilization.runningPct}% of window`} accent="text-[#10B981]" />
                <SummaryCard label="Idle Time" value={`${Math.round(utilization.idleMin)}m`} sub={`${utilization.idlePct}%`} />
                <SummaryCard label="Stoppages" value={`${Math.round(utilization.stoppageMin)}m`} sub={`${utilization.stoppageCount} incidents`} accent="text-warning" />
                <SummaryCard label="Maintenance" value={`${Math.round(utilization.maintenanceMin)}m`} sub={`${utilization.maintenancePct}%`} accent="text-info" />
              </div>
            </section>
          )}

          {detail?.nextOrder && matchesProcess(detail.nextOrder.subProcess, processFilter) && (
            <section className="bg-card text-card-foreground border border-border rounded-xl p-6 shadow">
              <h3 className="text-sm font-semibold tracking-tight mb-2">Next In Queue</h3>
              <p className="font-mono text-lg font-semibold">{detail.nextOrder.batchNumber}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {detail.nextOrder.customer} · Position #{detail.nextOrder.queuePosition}
                {detail.nextOrder.subProcess ? ` · ${processLabel(detail.nextOrder.subProcess)}` : ''}
              </p>
            </section>
          )}

          {detail?.orderQueue && filteredQueue.length > 0 && (
            <section className="bg-card border border-border rounded-xl p-6 shadow">
              <h3 className="text-sm font-semibold tracking-tight mb-3">Orders in Queue</h3>
              <ul className="divide-y divide-border text-sm">
                {filteredQueue.map((o) => (
                  <li key={o.batchNumber} className="py-2 flex justify-between gap-2 items-center">
                    <span className="font-mono font-semibold">{o.batchNumber}</span>
                    <span className="text-muted-foreground truncate">{o.customer}</span>
                    {o.subProcess && (
                      <span className="text-[10px] text-muted-foreground shrink-0">{processLabel(o.subProcess)}</span>
                    )}
                    <span className="text-xs font-bold uppercase shrink-0">{formatOrderStatusLabel(o.status)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {detail?.completedOrders && filteredCompleted.length > 0 && (
            <section className="bg-card border border-border rounded-xl p-6 shadow">
              <h3 className="text-sm font-semibold tracking-tight mb-3">Completed Orders</h3>
              <ul className="divide-y divide-border text-sm">
                {filteredCompleted.map((o) => (
                  <li key={`${o.batchNumber}-${o.completedAt}`} className="py-2 flex justify-between gap-2 items-center">
                    <span className="font-mono font-semibold">{o.batchNumber}</span>
                    <span className="text-muted-foreground">{o.weightMt} MT</span>
                    {o.subProcess && (
                      <span className="text-[10px] text-muted-foreground shrink-0">{processLabel(o.subProcess)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {timeline.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold tracking-tight text-foreground mb-3">Event History</h3>
              <div className="border border-border rounded-xl overflow-hidden shadow">
                <table className="w-full text-left text-sm bg-card text-card-foreground">
                  <thead className="bg-muted/30 border-b border-border text-xs font-medium text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Event</th>
                      <th className="px-4 py-3">Start</th>
                      <th className="px-4 py-3">Duration</th>
                      <th className="px-4 py-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {timeline.slice(0, 20).map((evt) => (
                      <tr key={evt.eventId} className="hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-3">
                          <span className="text-xs font-medium px-2 py-1 rounded-md border bg-muted/50 text-foreground">
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
