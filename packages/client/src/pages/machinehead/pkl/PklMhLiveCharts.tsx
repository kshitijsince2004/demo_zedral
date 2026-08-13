// PERF-A3 — recharts lives here; route-level lazy load (App / MhLiveEntry) keeps it off other pages.
import { memo, useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const ChartCard = memo(function ChartCard({
  title,
  data,
  series,
}: {
  title: string;
  data: Array<Record<string, number | string>>;
  series: Array<{ key: string; name: string; color: string }>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 h-64 shadow-sm">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground mb-2">{title}</p>
      <ResponsiveContainer width="100%" height="90%">
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Legend />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={`var(--color-chart-${s.color})`}
              fill={`color-mix(in oklab, var(--color-chart-${s.color}) 20%, transparent)`}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
});

const TANK_SERIES = [
  { n: 1, color: '1' },
  { n: 2, color: '4' },
  { n: 3, color: '2' },
] as const;

const TEMP_SERIES = TANK_SERIES.map((t) => ({ key: `t${t.n}Temp`, name: `T${t.n} °C`, color: t.color }));
const ACID_SERIES = TANK_SERIES.map((t) => ({ key: `t${t.n}Acid`, name: `T${t.n} acid`, color: t.color }));
const IRON_SERIES = TANK_SERIES.map((t) => ({ key: `t${t.n}Iron`, name: `T${t.n} iron`, color: t.color }));
const LEVEL_SERIES = TANK_SERIES.map((t) => ({ key: `t${t.n}Level`, name: `T${t.n} level`, color: t.color }));

export function PklMhTankTempsChart({
  data,
}: {
  data: Array<Record<string, number | string>>;
}) {
  return (
    <ChartCard
      title="Tank temps"
      data={data}
      series={TEMP_SERIES}
    />
  );
}

export function PklMhTankMetricCharts({
  data,
}: {
  data: Array<Record<string, number | string>>;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      <PklMhTankTempsChart data={data} />
      <ChartCard title="Acid %" data={data} series={ACID_SERIES} />
      <ChartCard title="Iron %" data={data} series={IRON_SERIES} />
      <ChartCard title="Level" data={data} series={LEVEL_SERIES} />
    </div>
  );
}

const TANK_COLOR: Record<1 | 2 | 3, string> = { 1: '1', 2: '4', 3: '2' };

/** Single-tank readings graph for MH live overview. */
export function PklMhSelectedTankChart({
  tankNo,
  data,
}: {
  tankNo: 1 | 2 | 3;
  data: Array<Record<string, number | string | null>>;
}) {
  const color = TANK_COLOR[tankNo];
  const series = useMemo(
    () => [
      { key: 'temp', name: 'Temp °C', color },
      { key: 'acid', name: 'Acid %', color },
      { key: 'iron', name: 'Iron %', color },
      { key: 'level', name: 'Level', color },
    ],
    [color],
  );
  const filtered = useMemo(
    () => data.filter((d) => d.temp != null || d.acid != null || d.iron != null || d.level != null) as Array<Record<string, number | string>>,
    [data],
  );
  return (
    <ChartCard
      title={`Tank T${tankNo} readings`}
      data={filtered}
      series={series}
    />
  );
}

/** Line-process trend chart (steam / dosage / rinse groups). */
export function PklMhLineProcessChart({
  title,
  data,
  series,
}: {
  title: string;
  data: Array<Record<string, number | string | null>>;
  series: Array<{ key: string; name: string; color: string }>;
}) {
  const filtered = useMemo(
    () => data.filter((d) => series.some((s) => d[s.key] != null)) as Array<Record<string, number | string>>,
    [data, series],
  );
  return (
    <ChartCard
      title={title}
      data={filtered}
      series={series}
    />
  );
}
