import React from 'react';
import type { LiveOrderRow, MachineStatusCard } from '@m1/shared-validation';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import { machineStatusLabel } from '../../hooks/useLiveSnapshot';
import { DataUnavailable } from './DataUnavailable';
import { Activity, Circle, Package } from 'lucide-react';

interface PlantOperationsAreaProps {
  data: ExtendedPlantHeadDashboardData;
  liveMachines?: MachineStatusCard[];
  liveOrders?: LiveOrderRow[];
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    Running: 'bg-emerald-500',
    Stopped: 'bg-amber-400',
    Maintenance: 'bg-blue-400',
    Breakdown: 'bg-red-500',
    Idle: 'bg-slate-400',
  };
  const animate = status === 'Running' ? 'animate-pulse' : '';
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${colors[status] ?? 'bg-slate-300'} ${animate}`} />
  );
}

function statusColor(status: string): string {
  if (status === 'Running') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (status === 'Stopped') return 'text-amber-700 bg-amber-50 border-amber-200';
  if (status === 'Maintenance') return 'text-blue-700 bg-blue-50 border-blue-200';
  if (status === 'Breakdown') return 'text-red-700 bg-red-50 border-red-200';
  return 'text-slate-600 bg-slate-50 border-slate-200';
}

function orderStatusLabel(status: LiveOrderRow['status']): string {
  return status.replace(/_/g, ' ');
}

function orderStatusStyle(status: LiveOrderRow['status']): string {
  if (status === 'IN_PROGRESS') return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  if (status === 'STOPPAGE') return 'text-amber-700 bg-amber-50 border-amber-200';
  if (status === 'COMPLETED') return 'text-slate-600 bg-slate-50 border-slate-200';
  return 'text-blue-700 bg-blue-50 border-blue-200';
}

export function PlantOperationsArea({ data, liveMachines, liveOrders }: PlantOperationsAreaProps) {
  const hasLiveMachines = liveMachines != null && liveMachines.length > 0;
  const hasLiveOrders = liveOrders != null && liveOrders.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Machine Utilization */}
      <div className="bg-white border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-500" />
              Machine Utilization
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {hasLiveMachines ? (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                  Live from /live/snapshot
                </span>
              ) : 'Live feed unavailable · showing plan attainment'}
            </p>
          </div>
          {hasLiveMachines && (
            <div className="flex items-center gap-2 text-xs">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-muted-foreground">{liveMachines!.filter(m => m.status === 'RUNNING').length} running</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-muted-foreground">{liveMachines!.filter(m => m.status === 'BREAKDOWN').length} down</span>
              </span>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-x-auto">
          {hasLiveMachines ? (
            <div className="divide-y divide-border/40">
              {liveMachines!.map((m) => {
                const status = machineStatusLabel(m.status);
                const progress = m.shiftProgressPct;
                return (
                  <div key={m.machineCode} className="px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50/60 transition-colors">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <StatusDot status={status} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-foreground truncate">{m.machineName}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{m.machineCode}</div>
                      </div>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md border ${statusColor(status)}`}>
                      {status}
                    </span>
                    <div className="w-24 shrink-0">
                      {progress != null ? (
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-muted-foreground">Shift</span>
                            <span className="text-xs font-bold text-foreground">{Math.round(progress)}%</span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-blue-500 transition-all"
                              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : data.lineAttainment.length > 0 ? (
            <>
              <div className="px-5 py-2.5 bg-amber-50/60 border-b border-border/50 text-xs text-amber-700 font-medium">
                Showing plan attainment (reporting window) — not live
              </div>
              <div className="divide-y divide-border/40">
                {data.lineAttainment.map((line) => (
                  <div key={line.lineId} className="px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50/60 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">{line.lineName}</div>
                      <div className="text-[10px] text-muted-foreground">{line.actualMt} MT actual</div>
                    </div>
                    <div className="w-28 shrink-0">
                      {line.plannedMt > 0 ? (
                        <div>
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-muted-foreground">Plan</span>
                            <span className="text-xs font-bold text-foreground">{line.attainmentPct}%</span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${line.attainmentPct >= 90 ? 'bg-emerald-500' : line.attainmentPct >= 70 ? 'bg-amber-400' : 'bg-red-400'}`}
                              style={{ width: `${Math.max(0, Math.min(100, line.attainmentPct))}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <DataUnavailable message="Live machine status and line attainment data are not available." />
          )}
        </div>
      </div>

      {/* Order Status */}
      <div className="bg-white border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Package className="w-4 h-4 text-violet-500" />
              Order Status
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {hasLiveOrders ? (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block" />
                  Active orders from /live/orders
                </span>
              ) : 'Live order feed unavailable'}
            </p>
          </div>
          {hasLiveOrders && (
            <div className="flex items-center gap-2 text-xs">
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-md">
                {liveOrders!.filter(o => o.status === 'IN_PROGRESS').length} active
              </span>
              {liveOrders!.filter(o => o.status === 'STOPPAGE').length > 0 && (
                <span className="bg-amber-50 text-amber-700 border border-amber-200 text-[10px] font-bold px-2 py-0.5 rounded-md">
                  {liveOrders!.filter(o => o.status === 'STOPPAGE').length} stopped
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-x-auto">
          {hasLiveOrders ? (
            <div className="divide-y divide-border/40">
              {liveOrders!.slice(0, 10).map((order) => (
                <div key={order.batchNumber} className="px-5 py-3.5 flex items-center gap-3 hover:bg-slate-50/60 transition-colors">
                  <Circle className={`w-2.5 h-2.5 shrink-0 fill-current ${order.status === 'IN_PROGRESS' ? 'text-emerald-500' : order.status === 'STOPPAGE' ? 'text-amber-500' : 'text-slate-300'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-mono font-semibold text-foreground truncate">{order.batchNumber}</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {order.machineName} · {order.currentProcess}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm text-foreground truncate max-w-[100px]">{order.customer}</div>
                    <span className={`inline-block text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border mt-1 ${orderStatusStyle(order.status)}`}>
                      {orderStatusLabel(order.status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <DataUnavailable message="Live order tracking is not available. Connect CRM production orders to populate this panel." />
          )}
        </div>
      </div>
    </div>
  );
}
