import React, { useCallback, useEffect, useState } from 'react';
import {
  reportingService,
  type ExtendedPlantHeadDashboardData,
} from '../../lib/reportingService';

import { PlantKpiStrip } from '../../components/plant-head/PlantKpiStrip';
import { PlantMainOpsArea } from '../../components/plant-head/PlantMainOpsArea';
import { PlantQualityDowntimeArea } from '../../components/plant-head/PlantQualityDowntimeArea';
import { PlantOperationsArea } from '../../components/plant-head/PlantOperationsArea';
import { PlantOpsFeed } from '../../components/plant-head/PlantOpsFeed';

export function PlantHeadDashboard() {
  const [windowDays, setWindowDays] = useState<1 | 7 | 30 | 90>(7);
  const [data, setData] = useState<ExtendedPlantHeadDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await reportingService.getExtendedPlantHeadDashboard(windowDays);
      setData(result);
    } catch (err: any) {
      setError(err?.message ?? 'Unable to load dashboard data');
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000); // Live poll every 30s
    return () => clearInterval(interval);
  }, [load]);

  if (loading && !data) return <div className="p-6 text-muted-foreground">Loading Command Center...</div>;
  if (error) {
    return (
      <div className="flex flex-col gap-6 w-full p-6">
        <div className="p-6 text-destructive bg-destructive/10 rounded-xl">{error}</div>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="flex flex-col w-full h-full pb-20 max-w-screen-2xl mx-auto">
      
      {/* Top Header / Controls */}
      <div className="flex items-center justify-between mb-6 mt-2 px-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Plant Head Dashboard</h1>
          <p className="text-sm font-medium text-muted-foreground mt-1">Enterprise Operations Overview</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value) as 1 | 7 | 30 | 90)}
            className="h-10 rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          >
            <option value={1}>Last 24 Hours</option>
            <option value={7}>Last 7 Days</option>
            <option value={30}>Last 30 Days</option>
            <option value={90}>Last 90 Days</option>
          </select>
        </div>
      </div>

      {/* Standardized 5-Row Layout */}
      <div className="flex flex-col gap-6 min-h-0">
        
        {/* Row 1: Executive KPI Strip */}
        <section>
          <PlantKpiStrip data={data} />
        </section>

        {/* Row 2: Main Operational Area (70/30) */}
        <section>
          <PlantMainOpsArea data={data} />
        </section>

        {/* Row 3: Quality & Downtime (50/50) */}
        <section>
          <PlantQualityDowntimeArea data={data} />
        </section>

        {/* Row 4: Operations (50/50) */}
        <section>
          <PlantOperationsArea data={data} />
        </section>

        {/* Row 5: Critical Operations Feed (100%) */}
        <section>
          <PlantOpsFeed data={data} />
        </section>

      </div>
    </div>
  );
}
