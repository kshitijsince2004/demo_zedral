import React from 'react';
import type { LiveOrderRow, MachineStatusCard } from '@m1/shared-validation';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import { machineStatusLabel } from '../../hooks/useLiveSnapshot';
import { DataUnavailable } from './DataUnavailable';
import { ZBadge } from '../primitives/ZBadge';

interface PlantOperationsAreaProps {
  data: ExtendedPlantHeadDashboardData;
  liveMachines?: MachineStatusCard[];
  liveOrders?: LiveOrderRow[];
}

function liveStatusTone(status: ReturnType<typeof machineStatusLabel>) {
  if (status === 'Running') return 'success' as const;
  if (status === 'Stopped') return 'warning' as const;
  if (status === 'Maintenance') return 'info' as const;
  return 'muted' as const;
}

function orderStatusLabel(status: LiveOrderRow['status']): string {
  return status.replace(/_/g, ' ');
}

function orderStatusTone(status: LiveOrderRow['status']) {
  if (status === 'IN_PROGRESS') return 'success' as const;
  if (status === 'STOPPAGE') return 'warning' as const;
  if (status === 'COMPLETED') return 'muted' as const;
  return 'info' as const;
}

export function PlantOperationsArea({ data, liveMachines, liveOrders }: PlantOperationsAreaProps) {
  const hasLiveMachines = liveMachines != null && liveMachines.length > 0;
  const hasLiveOrders = liveOrders != null && liveOrders.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50">
          <h2 className="font-semibold text-foreground">Machine Utilization</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {hasLiveMachines ? 'Live machine status from /live/snapshot' : 'Live machine feed unavailable'}
          </p>
        </div>
        <div className="p-0 flex-1 overflow-x-auto">
          {hasLiveMachines ? (
            <table className="w-full text-left">
              <thead className="bg-muted/30 border-b border-border/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Machine</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium text-right">Shift progress</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {liveMachines!.map((m) => {
                  const status = machineStatusLabel(m.status);
                  const progress = m.shiftProgressPct;
                  return (
                    <tr key={m.machineCode} className="hover:bg-muted/10 transition-colors">
                      <td className="px-5 py-3 align-middle text-sm font-medium text-foreground">
                        {m.machineName}
                      </td>
                      <td className="px-5 py-3 align-middle">
                        <ZBadge tone={liveStatusTone(status)} label={status} />
                      </td>
                      <td className="px-5 py-3 align-middle text-right text-sm font-semibold text-foreground">
                        {progress != null ? `${Math.round(progress)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : data.lineAttainment.length > 0 ? (
            <>
              <div className="px-5 py-3 text-xs text-muted-foreground border-b border-border/50 bg-muted/20">
                Showing plan attainment by process line (reporting window) — not live machine utilization
              </div>
              <table className="w-full text-left">
                <thead className="bg-muted/30 border-b border-border/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">Line</th>
                    <th className="px-5 py-3 font-medium text-right">Actual (MT)</th>
                    <th className="px-5 py-3 font-medium text-right">Plan attainment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {data.lineAttainment.map((line) => (
                    <tr key={line.lineId} className="hover:bg-muted/10 transition-colors">
                      <td className="px-5 py-3 align-middle text-sm font-medium text-foreground">
                        {line.lineName}
                      </td>
                      <td className="px-5 py-3 align-middle text-right text-sm text-foreground">
                        {line.actualMt}
                      </td>
                      <td className="px-5 py-3 align-middle text-right text-sm font-semibold text-foreground">
                        {line.plannedMt > 0 ? `${line.attainmentPct}%` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <DataUnavailable message="Live machine status and line attainment data are not available." />
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50">
          <h2 className="font-semibold text-foreground">Order Status</h2>
          <p className="text-xs text-muted-foreground mt-1">
            {hasLiveOrders ? 'Active orders from /live/orders' : 'Live order feed unavailable'}
          </p>
        </div>
        <div className="p-0 flex-1 overflow-x-auto">
          {hasLiveOrders ? (
            <table className="w-full text-left">
              <thead className="bg-muted/30 border-b border-border/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Order</th>
                  <th className="px-5 py-3 font-medium">Customer</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {liveOrders!.slice(0, 8).map((order) => (
                  <tr key={order.batchNumber} className="hover:bg-muted/10 transition-colors">
                    <td className="px-5 py-3 align-middle">
                      <div className="text-sm font-mono font-medium text-foreground">{order.batchNumber}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {order.machineName} · {order.currentProcess}
                      </div>
                    </td>
                    <td className="px-5 py-3 align-middle text-sm text-foreground">{order.customer}</td>
                    <td className="px-5 py-3 align-middle">
                      <ZBadge tone={orderStatusTone(order.status)} label={orderStatusLabel(order.status)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <DataUnavailable message="Live order tracking is not available. Connect CRM production orders to populate this panel." />
          )}
        </div>
      </div>
    </div>
  );
}
