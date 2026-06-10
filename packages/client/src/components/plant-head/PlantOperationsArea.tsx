import React from 'react';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import { ZBadge } from '../primitives/ZBadge';

interface PlantOperationsAreaProps {
  data: ExtendedPlantHeadDashboardData;
}

export function PlantOperationsArea({ data }: PlantOperationsAreaProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      
      {/* Left: Machine Utilization (50%) */}
      <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50">
          <h2 className="font-semibold text-foreground">Machine Utilization</h2>
        </div>
        <div className="p-0 flex-1 overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-muted/30 border-b border-border/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Machine</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Utilization</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {data.machineHealthGrid.map((m) => (
                <tr key={m.machineId} className="hover:bg-muted/10 transition-colors">
                  <td className="px-5 py-3 align-middle text-sm font-medium text-foreground">{m.machineName}</td>
                  <td className="px-5 py-3 align-middle">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      m.status === 'Running' ? 'bg-success/10 text-success' :
                      m.status === 'Idle' ? 'bg-muted text-muted-foreground' :
                      'bg-warning/10 text-warning'
                    }`}>
                      {m.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 align-middle text-right">
                    <div className="flex items-center justify-end gap-3">
                      <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${m.efficiencyPct > 80 ? 'bg-success' : m.efficiencyPct > 50 ? 'bg-warning' : 'bg-destructive'}`} 
                          style={{ width: `${m.efficiencyPct}%` }} 
                        />
                      </div>
                      <span className="text-sm font-semibold text-foreground w-8">{m.efficiencyPct}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right: Order Status (50%) */}
      <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50 flex justify-between items-center">
          <h2 className="font-semibold text-foreground">Order Status</h2>
          <div className="flex gap-2">
            <span className="text-xs bg-success/10 text-success px-2 py-0.5 rounded font-medium">{data.runningOrders} Running</span>
            <span className="text-xs bg-warning/10 text-warning px-2 py-0.5 rounded font-medium">{data.delayedOrders} Delayed</span>
          </div>
        </div>
        <div className="p-0 flex-1 overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-muted/30 border-b border-border/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Order</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {data.orderList.slice(0, 6).map((o) => (
                <tr key={o.orderNo} className="hover:bg-muted/10 transition-colors">
                  <td className="px-5 py-3 align-middle">
                    <div className="text-sm font-mono font-medium text-foreground">{o.orderNo}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{o.currentProcess}</div>
                  </td>
                  <td className="px-5 py-3 align-middle text-sm text-foreground">{o.customer}</td>
                  <td className="px-5 py-3 align-middle">
                    <ZBadge 
                      tone={o.status === 'Running' ? 'success' : o.status === 'Delayed' ? 'warning' : o.status === 'Blocked' ? 'destructive' : 'muted'} 
                      label={o.status} 
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
