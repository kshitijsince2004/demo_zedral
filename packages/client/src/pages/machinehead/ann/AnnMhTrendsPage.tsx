import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, RefreshCw, RotateCcw } from 'lucide-react';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../../components/primitives/ZButton';
import { ZFilterPills } from '../../../components/ui/operator/ZFilterPills';
import { apiClient } from '../../../lib/apiClient';
import type { AnnBoardRow } from '../../../components/process/bodies/AnnBaseCard';

// PERF-A3 — recharts via AnnMhTrendsCharts
const AnnMhTrendsMetricCard = lazy(() =>
  import('./AnnMhTrendsCharts').then((m) => ({ default: m.AnnMhTrendsMetricCard })),
);

type Reading = {
  reading_id: string;
  taken_at: string;
  charge_temp: number | string | null;
  gas_temp: number | string | null;
  fc_temp: number | string | null;
  base_press: number | string | null;
  base_fan_rpm: number | string | null;
  n2h2_flow: number | string | null;
  fuel_flow: number | string | null;
};

type MetricKey = 'charge_temp' | 'gas_temp' | 'fc_temp' | 'base_press' | 'base_fan_rpm' | 'n2h2_flow' | 'fuel_flow';

const METRICS: { key: MetricKey; label: string; unit: string }[] = [
  { key: 'charge_temp', label: 'Charge Temperature', unit: '°C' },
  { key: 'gas_temp', label: 'Gas Temperature', unit: '°C' },
  { key: 'fc_temp', label: 'F/C Temperature', unit: '°C' },
  { key: 'base_press', label: 'Base Pressure', unit: '' },
  { key: 'base_fan_rpm', label: 'Base Fan RPM', unit: 'RPM' },
  { key: 'n2h2_flow', label: 'N₂/H₂ Flow', unit: '' },
  { key: 'fuel_flow', label: 'Fuel Flow', unit: '' },
];

const FIELD_CLASS =
  'h-10 min-h-10 w-full rounded-full border border-input bg-background px-4 text-sm text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const LABEL_CLASS = 'text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground';

type MetricFilter = 'ALL' | MetricKey;

const METRIC_SHORT: Record<MetricKey, string> = {
  charge_temp: 'Charge',
  gas_temp: 'Gas',
  fc_temp: 'F/C',
  base_press: 'Pressure',
  base_fan_rpm: 'Fan RPM',
  n2h2_flow: 'N₂/H₂',
  fuel_flow: 'Fuel',
};

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toDateTimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return toDateTimeLocalValue(d);
}

function defaultTo() {
  return toDateTimeLocalValue(new Date());
}

/** Latest reading for a metric across loaded bases (display only). */
function latestSnapshot(byBase: Record<string, Reading[]>, metric: MetricKey) {
  let latestIso = '';
  let latestVal: number | null = null;
  for (const pts of Object.values(byBase)) {
    for (const p of pts) {
      const v = num(p[metric]);
      if (v == null) continue;
      if (!latestIso || p.taken_at > latestIso) {
        latestIso = p.taken_at;
        latestVal = v;
      }
    }
  }
  return { value: latestVal, at: latestIso || null };
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className={LABEL_CLASS}>{label}</span>
      {children}
    </label>
  );
}

function TrendsSkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2" aria-busy="true" aria-label="Loading trends">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="z-card flex h-[22rem] flex-col overflow-hidden p-6 animate-pulse">
          <div className="mb-4 space-y-2">
            <div className="h-3 w-28 rounded-full bg-muted" />
            <div className="h-7 w-24 rounded-full bg-muted" />
            <div className="h-2.5 w-32 rounded-full bg-muted" />
          </div>
          <div className="min-h-0 flex-1 rounded-xl bg-muted/60" />
          <div className="mt-4 flex gap-3 border-t border-border pt-3">
            <div className="h-6 w-16 rounded-full bg-muted" />
            <div className="h-6 w-16 rounded-full bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Multi-metric trends — base + search filters. */
export function AnnMhTrendsPage() {
  const navigate = useNavigate();
  const [board, setBoard] = useState<AnnBoardRow[]>([]);
  const [baseNo, setBaseNo] = useState('');
  const [search, setSearch] = useState('');
  // `datetime-local` expects *local* time, not a UTC ISO slice.
  const [from, setFrom] = useState(() => defaultFrom());
  const [to, setTo] = useState(() => defaultTo());
  const [byBase, setByBase] = useState<Record<string, Reading[]>>({});
  const [loading, setLoading] = useState(false);
  const [metricFilter, setMetricFilter] = useState<MetricFilter>('ALL');

  useEffect(() => {
    void apiClient.get<{ board: AnnBoardRow[] }>('/stations/ann/board').then((b) => setBoard(b.board ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fromMs = new Date(from).getTime();
      const toMs = new Date(to).getTime();
      const q = search.trim().toLowerCase();
      let targets = board.filter((r) => r.charge?.charge_no);
      if (baseNo) targets = targets.filter((r) => r.base_no === baseNo);
      if (q) {
        const matched: AnnBoardRow[] = [];
        for (const row of targets) {
          const batch = (row.charge?.annealing_batch_no ?? '').toLowerCase();
          const cn = (row.charge?.charge_no ?? '').toLowerCase();
          if (batch.includes(q) || cn.includes(q) || row.base_no.toLowerCase().includes(q)) {
            matched.push(row);
            continue;
          }
          const d = await apiClient.get<{ roster: { coil_no: string }[] }>(
            `/stations/ann/charges/${encodeURIComponent(row.charge!.charge_no)}`,
          );
          if ((d.roster ?? []).some((c) => c.coil_no.toLowerCase().includes(q))) matched.push(row);
        }
        targets = matched;
      }
      const next: Record<string, Reading[]> = {};
      await Promise.all(
        targets.map(async (row) => {
          const d = await apiClient.get<{ readings: Reading[] }>(
            `/stations/ann/charges/${encodeURIComponent(row.charge!.charge_no)}`,
          );
          next[row.base_no] = (d.readings ?? []).filter((r) => {
            const ms = new Date(r.taken_at).getTime();
            return ms >= fromMs && ms <= toMs;
          });
        }),
      );
      setByBase(next);
    } finally {
      setLoading(false);
    }
  }, [baseNo, board, from, search, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const colors = [
    'var(--color-chart-1)',
    'var(--color-chart-2)',
    'var(--color-chart-3)',
    'var(--color-chart-4)',
    'var(--color-chart-5)',
    'var(--color-primary)',
  ];
  const baseKeys = Object.keys(byBase);

  function chartData(metric: MetricKey) {
    const map = new Map<string, Record<string, string | number>>();
    for (const [base, pts] of Object.entries(byBase)) {
      for (const p of pts) {
        const v = num(p[metric]);
        if (v == null) continue;
        const label = new Date(p.taken_at).toLocaleString('en-IN', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        const row = map.get(p.taken_at) ?? { t: label };
        row[base] = v;
        map.set(p.taken_at, row);
      }
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
  }

  function resetFilters() {
    setBaseNo('');
    setSearch('');
    setFrom(defaultFrom());
    setTo(defaultTo());
    setMetricFilter('ALL');
  }

  const visibleMetrics = metricFilter === 'ALL' ? METRICS : METRICS.filter((m) => m.key === metricFilter);

  return (
    <MachineHeadShell
      title="ANN Trends"
      subtitle="All metrics by base"
      onRefresh={() => void load()}
      headerActions={
        <button
          type="button"
          onClick={() => navigate('/machine-head/ann/live')}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-border bg-background px-4 text-xs font-semibold text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Live
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="z-card sticky top-0 z-20 space-y-4 px-4 py-3.5 md:px-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_minmax(0,12rem)_minmax(0,12rem)_auto] xl:items-end">
            <FilterField label="Base">
              <select
                className={FIELD_CLASS}
                value={baseNo}
                onChange={(e) => setBaseNo(e.target.value)}
                aria-label="Filter by base"
              >
                <option value="">All open bases</option>
                {board.map((b) => (
                  <option key={b.base_no} value={b.base_no}>
                    {b.base_no}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Batch / coil / charge">
              <input
                className={`${FIELD_CLASS} font-mono`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ANN batch or coil…"
                aria-label="Search batch, coil, or charge"
              />
            </FilterField>

            <FilterField label="From">
              <input
                type="datetime-local"
                className={`${FIELD_CLASS} font-mono`}
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="From date and time"
              />
            </FilterField>

            <FilterField label="To">
              <input
                type="datetime-local"
                className={`${FIELD_CLASS} font-mono`}
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="To date and time"
              />
            </FilterField>

            <div className="flex flex-wrap items-end gap-2 sm:col-span-2 xl:col-span-1">
              <ZButton variant="secondary" size="sm" className="min-h-10 h-10 rounded-full px-4" onClick={() => void load()}>
                <RefreshCw className="h-4 w-4" aria-hidden />
                Refresh
              </ZButton>
              <ZButton variant="ghost" size="sm" className="min-h-10 h-10 rounded-full border border-border px-4" onClick={resetFilters}>
                <RotateCcw className="h-4 w-4" aria-hidden />
                Reset
              </ZButton>
            </div>
          </div>

          <div className="overflow-x-auto border-t border-border/60 pt-3">
            <ZFilterPills
              options={[
                { id: 'ALL', label: 'All metrics' },
                ...METRICS.map((m) => ({ id: m.key, label: METRIC_SHORT[m.key] })),
              ]}
              activeId={metricFilter}
              onChange={(id) => setMetricFilter(id as MetricFilter)}
            />
          </div>
        </div>

        {loading ? (
          <TrendsSkeletonGrid />
        ) : (
          <Suspense fallback={<TrendsSkeletonGrid />}>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {visibleMetrics.map((m) => {
                const data = chartData(m.key);
                const snap = latestSnapshot(byBase, m.key);
                return (
                  <AnnMhTrendsMetricCard
                    key={m.key}
                    title={m.label}
                    unit={m.unit}
                    liveValue={snap.value}
                    updatedAt={snap.at}
                    data={data}
                    baseKeys={baseKeys}
                    colors={colors}
                    hasAnyData={baseKeys.length > 0}
                  />
                );
              })}
            </div>
          </Suspense>
        )}
      </div>
    </MachineHeadShell>
  );
}
