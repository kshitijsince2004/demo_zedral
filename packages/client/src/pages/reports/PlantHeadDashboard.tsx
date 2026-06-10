import React, { useCallback, useEffect, useState } from 'react';
import type { LiveKpis } from '@m1/shared-validation';
import {
  reportingService,
  type ExtendedPlantHeadDashboardData,
} from '../../lib/reportingService';
import { useLiveSnapshot } from '../../hooks/useLiveSnapshot';

import { PlantKpiStrip } from '../../components/plant-head/PlantKpiStrip';
import { PlantMainOpsArea } from '../../components/plant-head/PlantMainOpsArea';
import { PlantQualityDowntimeArea } from '../../components/plant-head/PlantQualityDowntimeArea';
import { PlantOperationsArea } from '../../components/plant-head/PlantOperationsArea';
import { PlantOpsFeed } from '../../components/plant-head/PlantOpsFeed';
import { MachineStatusBoard } from '../../components/live/MachineStatusBoard';

export function PlantHeadDashboard() {
  const [windowDays, setWindowDays] = useState<1 | 7 | 30 | 90>(7);
  const [data, setData] = useState<ExtendedPlantHeadDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { snapshot } = useLiveSnapshot();

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
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  const liveKpis: LiveKpis | undefined = snapshot?.kpis;
  const liveMachines = snapshot?.machines ?? [];

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
      
      <div className="flex items-center justify-between mb-6 mt-2 px-1">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Plant Head Dashboard</h1>
          <p className="text-sm font-medium text-muted-foreground mt-1">Enterprise Operations Overview</p>
        </div>
        <div className="flex items-center gap-3">
          {snapshot?.refreshedAt && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              Live status · {new Date(snapshot.refreshedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
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

      <div className="flex flex-col gap-6 min-h-0">
        
        <section>
          <PlantKpiStrip data={data} liveKpis={liveKpis} />
        </section>

        {liveMachines.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center gap-2 ml-1">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Live Machine Status
              </h2>
            </div>
            <MachineStatusBoard machines={liveMachines} />
          </section>
        )}

        <section>
          <PlantMainOpsArea data={data} />
        </section>

        <section>
          <PlantQualityDowntimeArea data={data} />
        </section>

        <section>
          <PlantOperationsArea data={data} liveMachines={liveMachines} />
        </section>

        <section>
          <PlantOpsFeed data={data} />
        </section>

      </div>
    </div>
  );
}
