import React, { useState } from 'react';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import { AlertTriangle, X } from 'lucide-react';

interface AlertDockProps {
  data: ExtendedPlantHeadDashboardData;
}

export function FloatingAlertDock({ data }: AlertDockProps) {
  const [dismissed, setDismissed] = useState<string[]>([]);

  const activeAlerts = data.criticalAlerts.filter((a) => !dismissed.includes(a));

  if (activeAlerts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm w-full">
      {activeAlerts.map((alert, idx) => (
        <div 
          key={`${alert}-${idx}`}
          className="bg-destructive text-destructive-foreground p-4 rounded-lg shadow-2xl border border-destructive/50 flex items-start gap-3 animate-slide-in"
        >
          <div className="pt-0.5">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-destructive-foreground/80 mb-0.5">Critical Alert</h4>
            <p className="text-sm font-semibold leading-tight">{alert}</p>
          </div>
          <button 
            onClick={() => setDismissed(prev => [...prev, alert])}
            className="text-destructive-foreground/70 hover:text-destructive-foreground transition-colors p-1 -mr-2 -mt-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
