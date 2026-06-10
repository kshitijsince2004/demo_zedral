import React from 'react';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import { DataUnavailable } from './DataUnavailable';
import { AlertCircle, AlertTriangle, Bell, Info, ShieldAlert } from 'lucide-react';

interface PlantOpsFeedProps {
  data: ExtendedPlantHeadDashboardData;
}

function priorityConfig(priority: string) {
  switch (priority) {
    case 'Critical':
      return {
        icon: <ShieldAlert className="w-4 h-4" />,
        badge: 'text-red-700 bg-red-50 border-red-200',
        dot: 'bg-red-500',
        row: 'border-l-red-500',
      };
    case 'High':
      return {
        icon: <AlertTriangle className="w-4 h-4" />,
        badge: 'text-amber-700 bg-amber-50 border-amber-200',
        dot: 'bg-amber-400',
        row: 'border-l-amber-400',
      };
    case 'Medium':
      return {
        icon: <AlertCircle className="w-4 h-4" />,
        badge: 'text-blue-700 bg-blue-50 border-blue-200',
        dot: 'bg-blue-400',
        row: 'border-l-blue-400',
      };
    default:
      return {
        icon: <Info className="w-4 h-4" />,
        badge: 'text-slate-600 bg-slate-50 border-slate-200',
        dot: 'bg-slate-400',
        row: 'border-l-slate-300',
      };
  }
}

export function PlantOpsFeed({ data }: PlantOpsFeedProps) {
  const hasFeed = data.opsFeed.length > 0;
  const criticalCount = data.opsFeed.filter(e => e.priority === 'Critical').length;
  const highCount = data.opsFeed.filter(e => e.priority === 'High').length;

  return (
    <div className="bg-card border border-border rounded-lg shadow-sm flex flex-col overflow-hidden w-full">
      <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Bell className="w-4 h-4 text-slate-500" />
            Operations Event Feed
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">Verified operational events only</p>
        </div>
        {hasFeed && (
          <div className="flex items-center gap-2">
            {criticalCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-md">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                {criticalCount} critical
              </span>
            )}
            {highCount > 0 && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md">
                {highCount} high
              </span>
            )}
            <span className="text-[10px] font-semibold text-muted-foreground bg-slate-100 px-2 py-1 rounded-md">
              {data.opsFeed.length} total
            </span>
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        {hasFeed ? (
          <div className="divide-y divide-border/40">
            {data.opsFeed.map((event) => {
              const cfg = priorityConfig(event.priority);
              return (
                <div
                  key={event.id}
                  className={`flex items-start gap-4 px-5 py-4 hover:bg-muted/30 transition-colors border-l-4 ${cfg.row}`}
                >
                  <div className={`mt-0.5 ${cfg.badge.split(' ').find(c => c.startsWith('text-'))}`}>
                    {cfg.icon}
                  </div>
                  <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-[auto_auto_auto_1fr] gap-x-6 gap-y-1 items-start">
                    <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">{event.timestamp}</span>
                    <span className="text-sm font-semibold text-foreground whitespace-nowrap">{event.machine}</span>
                    <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">{event.order || '—'}</span>
                    <span className="text-sm text-foreground">{event.description}</span>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-md border ${cfg.badge}`}>
                    {event.priority}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <DataUnavailable message="Operations event feed is not configured. No events are available." />
        )}
      </div>
    </div>
  );
}
