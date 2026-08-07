// PERF-A3 — recharts only when metric cards mount.
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { LegendProps, TooltipProps } from 'recharts';
import { LineChart as LineChartIcon } from 'lucide-react';

type ChartPoint = Record<string, string | number>;

function formatLiveValue(v: number | null): string {
  if (v == null) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'No readings';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'Updated just now';
  if (ms < 60_000) return `Updated ${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `Updated ${Math.round(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `Updated ${Math.round(ms / 3_600_000)}h ago`;
  return `Updated ${new Date(iso).toLocaleString('en-IN', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
}

function EmptyChartState() {
  return (
    <div className="flex h-full min-h-[14rem] flex-col items-center justify-center gap-3 px-4 text-center animate-fade-in">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/80 text-muted-foreground">
        <LineChartIcon className="h-6 w-6 opacity-70" aria-hidden />
      </div>
      <p className="max-w-[16rem] text-sm text-muted-foreground">
        No process data available for selected filters
      </p>
    </div>
  );
}

function TrendsTooltip({
  active,
  payload,
  label,
  unit,
}: TooltipProps<number, string> & { unit?: string }) {
  if (!active || !payload?.length) return null;
  const values = payload
    .filter((p) => p.value != null && Number.isFinite(Number(p.value)))
    .map((p) => ({ name: String(p.name ?? p.dataKey ?? ''), value: Number(p.value), color: String(p.color ?? '') }));
  if (values.length === 0) return null;

  let diff: number | null = null;
  if (values.length === 2) diff = values[0].value - values[1].value;

  return (
    <div className="z-card min-w-[10rem] animate-fade-in px-3 py-2.5 shadow-lg">
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <ul className="space-y-1.5">
        {values.map((v) => (
          <li key={v.name} className="flex items-baseline justify-between gap-4 text-xs">
            <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: v.color }} aria-hidden />
              {v.name}
            </span>
            <span className="font-mono tabular-nums font-semibold text-foreground">
              {formatLiveValue(v.value)}
              {unit ? <span className="ml-0.5 text-[10px] font-sans font-normal text-muted-foreground">{unit}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {diff != null && (
        <p className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
          Difference{' '}
          <span className="font-mono tabular-nums font-semibold text-foreground">
            {diff > 0 ? '+' : ''}
            {formatLiveValue(diff)}
            {unit ? ` ${unit}` : ''}
          </span>
        </p>
      )}
    </div>
  );
}

function TrendsLegend({
  payload,
  onClick,
}: {
  payload?: LegendProps['payload'];
  onClick?: LegendProps['onClick'];
}) {
  if (!payload?.length) return null;
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
      {payload.map((entry) => {
        const inactive = entry.inactive;
        return (
          <li key={String(entry.value)}>
            <button
              type="button"
              className={[
                'inline-flex min-h-8 items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-all',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                inactive
                  ? 'border-border bg-background opacity-45 line-through'
                  : 'border-border bg-card hover:border-primary/30 hover:bg-muted',
              ].join(' ')}
              onClick={(e) => onClick?.(entry, 0, e)}
              aria-pressed={!inactive}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: String(entry.color ?? 'var(--color-primary)') }}
                aria-hidden
              />
              <span className="font-mono tabular-nums">{entry.value}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function AnnMhTrendsMetricCard({
  title,
  unit,
  liveValue,
  updatedAt,
  data,
  baseKeys,
  colors,
  hasAnyData,
}: {
  title: string;
  unit: string;
  liveValue: number | null;
  updatedAt: string | null;
  data: ChartPoint[];
  baseKeys: string[];
  colors: string[];
  hasAnyData: boolean;
}) {
  return (
    <article className="z-card z-card-hover flex min-h-[22rem] flex-col p-6 animate-fade-in">
      <header className="mb-4 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          {unit ? (
            <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {unit}
            </span>
          ) : null}
        </div>
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span className="text-2xl font-bold font-mono tabular-nums tracking-tight text-foreground">
            {formatLiveValue(liveValue)}
          </span>
          {liveValue != null && (
            <span className="ml-1 inline-flex h-1.5 w-1.5 rounded-full bg-status-running animate-pulse-dot" aria-label="Live" />
          )}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{formatRelative(updatedAt)}</p>
      </header>

      <div className="min-h-0 flex-1">
        {!hasAnyData || data.length === 0 ? (
          <EmptyChartState />
        ) : (
          <ResponsiveContainer width="100%" height="100%" minHeight={220}>
            <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
              <XAxis
                dataKey="t"
                tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
                tickMargin={8}
                minTickGap={28}
                axisLine={{ stroke: 'var(--color-border)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
                tickMargin={6}
                width={44}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                cursor={{ stroke: 'var(--color-primary)', strokeWidth: 1, strokeDasharray: '4 4' }}
                content={<TrendsTooltip unit={unit} />}
              />
              <Legend
                verticalAlign="bottom"
                align="left"
                wrapperStyle={{ paddingTop: 12 }}
                content={(props) => <TrendsLegend payload={props.payload} onClick={props.onClick} />}
              />
              {baseKeys.map((b, i) => (
                <Line
                  key={b}
                  type="monotone"
                  dataKey={b}
                  name={b}
                  stroke={colors[i % colors.length]}
                  dot={false}
                  strokeWidth={2}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                  isAnimationActive
                  animationDuration={400}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </article>
  );
}
