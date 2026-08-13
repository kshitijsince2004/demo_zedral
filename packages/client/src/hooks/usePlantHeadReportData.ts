import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  reportingService,
  type ExtendedPlantHeadDashboardData,
} from '../lib/reportingService';
import { mergePlantHeadWithLive } from '../lib/plantHeadLiveMerge';
import { useLiveSnapshot, LIVE_POLL_MS } from './useLiveSnapshot';
import { liveService } from '../lib/liveService';
import { subscribeProductionChanged } from '../lib/productionSync';
import { jsonFingerprint } from '../lib/silentRefresh';
import type { LiveOrderRow } from '@m1/shared-validation';

export type PlantReportWindow = 1 | 7 | 30 | 90;

/**
 * Shared loader for Plant Head satellite report pages.
 * Loads reporting window data and overlays live snapshot / orders.
 */
export function usePlantHeadReportData(defaultWindow: PlantReportWindow = 7) {
  const [windowDays, setWindowDays] = useState<PlantReportWindow>(defaultWindow);
  const [data, setData] = useState<ExtendedPlantHeadDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveOrders, setLiveOrders] = useState<LiveOrderRow[]>([]);
  const { snapshot } = useLiveSnapshot();
  const prevFpRef = useRef('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await reportingService.getExtendedPlantHeadDashboard(windowDays);
      const fingerprint = jsonFingerprint(result);
      if (fingerprint !== prevFpRef.current) {
        prevFpRef.current = fingerprint;
        setData(result);
      } else {
        setData(result);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load plant report');
    } finally {
      setLoading(false);
    }
  }, [windowDays]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let active = true;
    const pullOrders = () => {
      void liveService
        .getOrders()
        .then((res) => {
          if (active) setLiveOrders(res.orders);
        })
        .catch(() => {
          if (active) setLiveOrders([]);
        });
    };
    pullOrders();
    const id = setInterval(pullOrders, LIVE_POLL_MS);
    const unsub = subscribeProductionChanged(() => pullOrders());
    return () => {
      active = false;
      clearInterval(id);
      unsub();
    };
  }, []);

  const liveMachines = useMemo(
    () => (snapshot?.machines ?? []).filter((m) => m.status !== 'OFFLINE'),
    [snapshot?.machines],
  );

  const displayData = useMemo(
    () => (data ? mergePlantHeadWithLive(data, snapshot?.kpis, liveMachines, liveOrders) : null),
    [data, snapshot?.kpis, liveMachines, liveOrders],
  );

  return {
    windowDays,
    setWindowDays,
    data: displayData,
    loading,
    error,
    refresh: load,
  };
}