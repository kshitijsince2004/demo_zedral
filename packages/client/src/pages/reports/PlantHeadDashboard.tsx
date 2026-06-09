import { useCallback, useEffect, useState } from 'react';
import { ZButton } from '../../components/primitives/ZButton';
import { ExecutiveShell } from '../../components/layout/executive/ExecutiveShell';
import { reportingService, type PlantHeadDashboardData } from '../../lib/reportingService';
import { machineHandoverService } from '../../services/machineHandoverService';

const FETCH_TIMEOUT_MS = 10_000;

const WINDOW_OPTIONS: Array<{ days: 1 | 7 | 30 | 90; label: string }> = [
  { days: 1, label: '1d' },
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

type LoadState = 'loading' | 'ok' | 'timeout' | 'error';

function fetchWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

export function PlantHeadDashboard() {
  const [windowDays, setWindowDays] = useState<1 | 7 | 30 | 90>(7);
  const [data, setData] = useState<PlantHeadDashboardData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [reloadKey, setReloadKey] = useState(0);

  const loadDashboard = useCallback(async () => {
    setLoadState('loading');
    setData(null);
    try {
      const [dashboard] = await Promise.all([
        fetchWithTimeout(reportingService.getPlantHeadDashboard(windowDays), FETCH_TIMEOUT_MS),
        machineHandoverService.getOverview().catch(() => null),
      ]);
      setData(dashboard);
      setLoadState('ok');
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (message === 'timeout') {
        setLoadState('timeout');
      } else {
        setLoadState('error');
      }
    }
  }, [windowDays]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard, reloadKey]);

  const windowControls = (
    <div className="flex items-center gap-2">
      {WINDOW_OPTIONS.map(({ days, label }) => (
        <ZButton
          key={days}
          variant={windowDays === days ? 'accent' : 'secondary'}
          size="sm"
          onClick={() => setWindowDays(days)}
        >
          {label}
        </ZButton>
      ))}
    </div>
  );

  return (
    <ExecutiveShell title="Plant Overview" subtitle="Executive production dashboard" controls={windowControls}>
      {loadState === 'loading' && (
        <div className="h-48 rounded-2xl bg-secondary animate-pulse" aria-busy="true" />
      )}

      {loadState === 'timeout' && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Live data is unavailable. Try again later.</p>
        </div>
      )}

      {loadState === 'error' && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-6 text-center space-y-3">
          <p className="text-sm text-destructive">Plant overview could not be loaded.</p>
          <ZButton variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
            Retry
          </ZButton>
        </div>
      )}

      {loadState === 'ok' && data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Plant OEE</p>
            <p className="text-3xl font-bold font-mono">{data.plantWideOee}%</p>
            <p className="text-xs text-muted-foreground mt-1">Target {data.oeeTarget}%</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Lines tracked</p>
            <p className="text-3xl font-bold font-mono">{data.productionVsPlan.length}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-1">Top defects</p>
            <p className="text-3xl font-bold font-mono">{data.topDefects.length}</p>
          </div>
        </div>
      )}
    </ExecutiveShell>
  );
}
