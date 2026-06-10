import React, { useCallback, useEffect, useState } from 'react';
import type { LiveKpis, LiveOrderRow } from '@m1/shared-validation';
import {
  reportingService,
  type ExtendedPlantHeadDashboardData,
} from '../../lib/reportingService';
import { useLiveSnapshot, LIVE_POLL_MS } from '../../hooks/useLiveSnapshot';
import { liveService } from '../../lib/liveService';

import { PlantKpiStrip } from '../../components/plant-head/PlantKpiStrip';
import { PlantMainOpsArea } from '../../components/plant-head/PlantMainOpsArea';
import { PlantQualityDowntimeArea } from '../../components/plant-head/PlantQualityDowntimeArea';
import { PlantOperationsArea } from '../../components/plant-head/PlantOperationsArea';
import { PlantOpsFeed } from '../../components/plant-head/PlantOpsFeed';
import { MachineStatusBoard } from '../../components/live/MachineStatusBoard';
import { Activity, AlertTriangle, CalendarDays, Factory, RefreshCw } from 'lucide-react';

function useLiveClock() {
  const [time, setTime] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

export function PlantHeadDashboard() {
  const [windowDays, setWindowDays] = useState<1 | 7 | 30 | 90>(7);
  const [data, setData] = useState<ExtendedPlantHeadDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveOrders, setLiveOrders] = useState<LiveOrderRow[]>([]);
  const { snapshot } = useLiveSnapshot();
  const clock = useLiveClock();

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const result = await reportingService.getExtendedPlantHeadDashboard(windowDays);
      setData(result);
    } catch (err: any) {
      setError(err?.message ?? 'Unable to load dashboard data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [windowDays]);

  useEffect(() => {
    load(false);
    const interval = setInterval(() => load(true), 30000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    let active = true;
    const loadOrders = () => {
      liveService
        .getOrders()
        .then((res) => { if (active) setLiveOrders(res.orders); })
        .catch(() => { if (active) setLiveOrders([]); });
    };
    loadOrders();
    const interval = setInterval(loadOrders, LIVE_POLL_MS);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const liveKpis: LiveKpis | undefined = snapshot?.kpis;
  const liveMachines = snapshot?.machines ?? [];

  if (loading && !data) {
    return (
      <div
        className="flex items-center justify-center min-h-[320px]"
        data-testid="plant-head-dashboard-loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Factory className="w-10 h-10 animate-pulse opacity-40" aria-hidden />
          <span className="text-sm font-medium">Loading Command Center…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6 w-full p-6" data-testid="plant-head-dashboard-error" role="alert">
        <div className="flex items-start gap-3 p-5 text-red-700 bg-red-50 border border-red-200 rounded-xl">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
          <div>
            <div className="font-semibold text-sm mb-1">Failed to load dashboard</div>
            <div className="text-sm">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const today = clock.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const timeStr = clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div
      className="flex flex-col w-full h-full pb-6 max-w-screen-2xl mx-auto"
      data-testid="plant-head-dashboard"
      role="main"
      aria-label="Plant command center"
    >

      {/* Header */}
      <div className="flex justify-end gap-4 mb-3 px-1">

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => load(false)}
            disabled={loading || refreshing}
            aria-label="Refresh dashboard"
            className="flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-info' : ''}`} aria-hidden />
            Refresh
          </button>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value) as 1 | 7 | 30 | 90)}
            aria-label="Reporting time window"
            className="h-9 rounded-lg border border-input bg-card px-3 text-sm font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            <option value={1}>Last 24 Hours</option>
            <option value={7}>Last 7 Days</option>
            <option value={30}>Last 30 Days</option>
            <option value={90}>Last 90 Days</option>
          </select>
        </div>
      </div>



      <div className="flex flex-col gap-5 min-h-0">

        {/* KPI Strip */}
        <section aria-label="Key performance indicators">
          <PlantKpiStrip data={data} liveKpis={liveKpis} />
        </section>

        {/* Live Machine Status Board */}
        {liveMachines.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="px-1">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Live Shopfloor Status
              </h2>
            </div>
            <MachineStatusBoard machines={liveMachines} />
          </section>
        )}

        {/* Production + Insights */}
        <section>
          <PlantMainOpsArea data={data} />
        </section>

        {/* Quality + Downtime */}
        <section>
          <PlantQualityDowntimeArea data={data} />
        </section>

        {/* Machine Utilization + Orders */}
        <section>
          <PlantOperationsArea data={data} liveMachines={liveMachines} liveOrders={liveOrders} />
        </section>

        {/* Ops Feed */}
        <section>
          <PlantOpsFeed data={data} />
        </section>

      </div>
    </div>
  );
}
