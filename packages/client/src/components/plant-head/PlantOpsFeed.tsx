import React from 'react';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import { ZBadge } from '../primitives/ZBadge';

interface PlantOpsFeedProps {
  data: ExtendedPlantHeadDashboardData;
}

export function PlantOpsFeed({ data }: PlantOpsFeedProps) {
  const getSeverityTone = (priority: string) => {
    switch (priority) {
      case 'Critical': return 'destructive';
      case 'High': return 'warning';
      case 'Medium': return 'info';
      default: return 'muted';
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden w-full">
      <div className="px-5 py-4 border-b border-border/50 flex justify-between items-center">
        <h2 className="font-semibold text-foreground">Critical Operations Feed</h2>
        <span className="text-xs bg-destructive/10 text-destructive px-2 py-0.5 rounded font-medium">{data.activeAlerts} Active Alerts</span>
      </div>
      <div className="p-0 overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-muted/30 border-b border-border/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Time</th>
              <th className="px-5 py-3 font-medium">Machine</th>
              <th className="px-5 py-3 font-medium">Order</th>
              <th className="px-5 py-3 font-medium">Severity</th>
              <th className="px-5 py-3 font-medium">Description</th>
              <th className="px-5 py-3 font-medium">Impact</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {data.opsFeed.map((event) => (
              <tr key={event.id} className="hover:bg-muted/10 transition-colors">
                <td className="px-5 py-4 align-top text-sm font-mono text-muted-foreground whitespace-nowrap">
                  {event.timestamp}
                </td>
                <td className="px-5 py-4 align-top text-sm font-medium text-foreground whitespace-nowrap">
                  {event.machine}
                </td>
                <td className="px-5 py-4 align-top text-sm font-mono text-muted-foreground whitespace-nowrap">
                  {event.order}
                </td>
                <td className="px-5 py-4 align-top whitespace-nowrap">
                  <ZBadge tone={getSeverityTone(event.priority)} label={event.priority} />
                </td>
                <td className="px-5 py-4 align-top">
                  <div className="text-sm text-foreground mb-1">{event.description}</div>
                  <div className="text-xs text-muted-foreground"><span className="font-medium text-foreground/80">Action:</span> {event.recommendedAction}</div>
                </td>
                <td className="px-5 py-4 align-top text-sm text-foreground whitespace-nowrap">
                  {event.impact}
                </td>
              </tr>
            ))}
            {data.opsFeed.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-sm text-muted-foreground">
                  No critical events recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
