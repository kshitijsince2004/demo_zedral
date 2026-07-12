import { useEffect, useState } from 'react';
import { reportingService, type ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import { Timer, AlertTriangle } from 'lucide-react';

export function PlantStoppages() {
  const [data, setData] = useState<ExtendedPlantHeadDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    reportingService.getExtendedPlantHeadDashboard(7)
      .then(res => {
        if (active) {
          setData(res);
          setError(null);
        }
      })
      .catch(err => {
        if (active) setError(err.message || 'Failed to load stoppage data');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  if (loading) {
    return <div className="p-8 text-muted-foreground text-center animate-pulse">Loading downtime metrics...</div>;
  }

  if (error) {
    return <div className="p-8 text-destructive text-center">Error: {error}</div>;
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Timer className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-bold text-foreground">Downtime Analysis</h1>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">MTTR</p>
          <p className="text-2xl font-mono mt-1 font-bold text-warning">{data.mttrHours} <span className="text-sm text-muted-foreground">hrs</span></p>
        </div>
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Availability</p>
          <p className="text-2xl font-mono mt-1 font-bold text-success">{data.availabilityPct}%</p>
        </div>
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Active Alerts</p>
          <p className="text-2xl font-mono mt-1 font-bold text-destructive">{data.activeAlerts}</p>
        </div>
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Breakdown Machines</p>
          <p className="text-2xl font-mono mt-1 font-bold">{data.breakdownMachines}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Top Downtime Drivers</h2>
          <div className="space-y-4">
            {data.downtimeDrivers.length > 0 ? data.downtimeDrivers.map((driver, i) => (
              <div key={i} className="flex items-center gap-3">
                <AlertTriangle className={`h-4 w-4 shrink-0 ${driver.type === 'UNPLANNED' ? 'text-destructive' : 'text-warning'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{driver.reason}</p>
                  <p className="text-xs text-muted-foreground">{driver.type} · {driver.occurrences} incidents</p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-bold text-sm text-warning">{driver.totalMinutes} min</p>
                </div>
              </div>
            )) : (
              <p className="text-sm text-muted-foreground text-center py-4">No downtime recorded</p>
            )}
          </div>
        </div>

        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Downtime by Category</h2>
          <div className="space-y-3">
            {data.downtimeByCategory.length > 0 ? (
              data.downtimeByCategory.map((cat, i) => (
                <div key={i} className="flex justify-between items-center text-sm border-b border-border/50 pb-2 last:border-0 last:pb-0">
                  <span className="font-semibold text-muted-foreground">{cat.category}</span>
                  <span className="font-mono text-warning font-bold">{cat.minutes} <span className="text-xs font-normal">min</span></span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No category data</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
