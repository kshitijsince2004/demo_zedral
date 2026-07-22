import { Bell, AlertCircle, Info } from 'lucide-react';
import { formatPlantDateTime } from '../../lib/dateFormat';
import { usePlantHeadReportData } from '../../hooks/usePlantHeadReportData';
import { PlantReportWindowSelect } from '../../components/plant-head/PlantReportWindowSelect';

function formatFeedTime(value: string): string {
  // Live merge uses ISO; reporting fallback may already be ISO (generatedAt).
  if (/^\d{4}-\d{2}-\d{2}/.test(value) || value.includes('T')) {
    return formatPlantDateTime(value);
  }
  return value;
}

export function PlantAlerts() {
  const { windowDays, setWindowDays, data, loading, error } = usePlantHeadReportData(7);

  if (loading && !data) {
    return <div className="p-8 text-muted-foreground text-center animate-pulse">Loading alerts...</div>;
  }

  if (error && !data) {
    return <div className="p-8 text-destructive text-center">Error: {error}</div>;
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bell className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Active Alerts & Ops Feed</h1>
        </div>
        <PlantReportWindowSelect value={windowDays} onChange={setWindowDays} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-destructive/10 border border-destructive/20 rounded-xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-destructive">Critical Alerts</p>
          <p className="text-2xl font-mono mt-1 font-bold text-destructive">{data.criticalAlerts.length}</p>
        </div>
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Active Warnings</p>
          <p className="text-2xl font-mono mt-1 font-bold text-warning">{data.activeAlerts}</p>
        </div>
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Ops Events</p>
          <p className="text-2xl font-mono mt-1 font-bold text-info">{data.opsFeed.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-border rounded-xl shadow-sm p-4 lg:col-span-1">
          <h2 className="text-sm font-bold uppercase tracking-widest text-destructive flex items-center gap-2 mb-4">
            <AlertCircle className="h-4 w-4" /> Critical System Alerts
          </h2>
          <div className="space-y-3">
            {data.criticalAlerts.length > 0 ? (
              data.criticalAlerts.map((alert, i) => (
                <div key={i} className="p-3 bg-destructive/5 border border-destructive/20 rounded-lg text-sm text-destructive">
                  {alert}
                </div>
              ))
            ) : (
              <div className="p-6 text-center text-sm text-success bg-success/5 rounded-lg border border-success/20">
                All systems nominal. No critical alerts.
              </div>
            )}
          </div>
        </div>

        <div className="bg-white border border-border rounded-xl shadow-sm p-4 lg:col-span-2 flex flex-col min-h-[400px]">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Live Ops Feed</h2>
          <div className="flex-1 overflow-y-auto space-y-4">
            {data.opsFeed.length > 0 ? (
              data.opsFeed.map((event) => (
                <div key={event.id} className="flex gap-4 border-b border-border/50 pb-3 last:border-0 last:pb-0">
                  <div className="shrink-0 pt-1">
                    {event.priority === 'Critical' ? (
                      <AlertCircle className="h-5 w-5 text-destructive" />
                    ) : event.priority === 'High' ? (
                      <AlertCircle className="h-5 w-5 text-warning" />
                    ) : (
                      <Info className="h-5 w-5 text-info" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-semibold text-sm">{event.machine}{event.order ? ` · ${event.order}` : ''}</span>
                      <span className="text-xs text-muted-foreground font-mono">{formatFeedTime(event.timestamp)}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{event.description}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-12">No recent operations events recorded.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
