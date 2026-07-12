import { useEffect, useState } from 'react';
import { reportingService, type ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import { Brain, AlertCircle } from 'lucide-react';

export function PlantDefects() {
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
        if (active) setError(err.message || 'Failed to load defect data');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  if (loading) {
    return <div className="p-8 text-muted-foreground text-center animate-pulse">Loading defect metrics...</div>;
  }

  if (error) {
    return <div className="p-8 text-destructive text-center">Error: {error}</div>;
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Brain className="h-6 w-6 text-primary" />
        <h1 className="text-xl font-bold text-foreground">Defect Analysis</h1>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Defects Today</p>
          <p className="text-2xl font-mono mt-1 font-bold text-destructive">{data.defectsToday}</p>
        </div>
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Current Defect Rate</p>
          <p className="text-2xl font-mono mt-1 font-bold text-warning">{data.defectPct}%</p>
        </div>
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Total Categories</p>
          <p className="text-2xl font-mono mt-1 font-bold">{data.defectsByCategory.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Top Defects (Last 7 Days)</h2>
          <div className="space-y-4">
            {data.topDefects.length > 0 ? data.topDefects.map(defect => (
              <div key={defect.defectCode} className="flex items-center gap-3">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{defect.defectName || defect.defectCode}</p>
                  <p className="text-xs text-muted-foreground">Code: {defect.defectCode}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-bold text-sm">{defect.count}</p>
                  <p className={`text-xs ${defect.wowDelta > 0 ? 'text-destructive' : 'text-success'}`}>
                    {defect.wowDelta > 0 ? '+' : ''}{defect.wowDelta}% WoW
                  </p>
                </div>
              </div>
            )) : (
              <p className="text-sm text-muted-foreground text-center py-4">No defect data available</p>
            )}
          </div>
        </div>

        <div className="bg-white border border-border rounded-xl shadow-sm p-4">
          <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground mb-4">Defect Trend</h2>
          <div className="space-y-3">
            {data.defectTrend.length > 0 ? (
              data.defectTrend.map((trend, i) => (
                <div key={i} className="flex justify-between items-center text-sm border-b border-border/50 pb-2 last:border-0 last:pb-0">
                  <span className="font-mono text-muted-foreground">{trend.date}</span>
                  <span className="font-semibold text-warning">{trend.defects}%</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No trend data</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
