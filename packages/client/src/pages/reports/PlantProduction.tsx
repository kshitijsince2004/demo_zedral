import { Activity } from 'lucide-react';
import { usePlantHeadReportData } from '../../hooks/usePlantHeadReportData';
import { PlantReportWindowSelect } from '../../components/plant-head/PlantReportWindowSelect';

export function PlantProduction() {
  const { windowDays, setWindowDays, data, loading, error } = usePlantHeadReportData(7);

  if (loading && !data) {
    return <div className="p-8 text-muted-foreground text-center animate-pulse">Loading production metrics...</div>;
  }

  if (error && !data) {
    return <div className="p-8 text-destructive text-center">Error: {error}</div>;
  }

  if (!data) return null;

  const windowLabel = windowDays === 1 ? '24 Hours' : `${windowDays} Days`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Activity className="h-6 w-6 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Production Monitoring</h1>
        </div>
        <PlantReportWindowSelect value={windowDays} onChange={setWindowDays} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Today&apos;s Production</p>
          <p className="text-2xl font-mono mt-1 font-bold">{data.productionTodayMt} <span className="text-sm text-muted-foreground">MT</span></p>
        </div>
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Overall Target</p>
          <p className="text-2xl font-mono mt-1 font-bold">{data.productionTarget} <span className="text-sm text-muted-foreground">MT</span></p>
        </div>
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">OEE</p>
          <p className="text-2xl font-mono mt-1 font-bold">{data.oeePct}%</p>
        </div>
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Utilization</p>
          <p className="text-2xl font-mono mt-1 font-bold">{data.utilizationPct}%</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Line Attainment</h2>
          <div className="space-y-4">
            {data.lineAttainment.length > 0 ? data.lineAttainment.map((line) => (
              <div key={line.lineId}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="font-semibold">{line.lineName}</span>
                  <span className="font-mono">{line.actualMt} / {line.plannedMt} MT ({line.attainmentPct}%)</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${line.attainmentPct >= 90 ? 'bg-success' : line.attainmentPct >= 70 ? 'bg-warning' : 'bg-destructive'}`}
                    style={{ width: `${Math.min(100, line.attainmentPct)}%` }}
                  />
                </div>
              </div>
            )) : (
              <p className="text-sm text-muted-foreground text-center py-4">No line data available</p>
            )}
          </div>
        </div>

        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Daily Production (Last {windowLabel})</h2>
          <div className="space-y-3">
            {data.dailyProduction.length > 0 ? (
              data.dailyProduction.map((day) => (
                <div key={day.date} className="flex justify-between items-center text-sm border-b border-border/50 pb-2 last:border-0 last:pb-0">
                  <span className="font-mono text-muted-foreground">{day.date}</span>
                  <div className="flex gap-4">
                    <span className="text-muted-foreground">Target: <span className="font-mono">{day.target}</span></span>
                    <span className="font-semibold">Actual: <span className="font-mono">{day.actual}</span></span>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No daily production data</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
