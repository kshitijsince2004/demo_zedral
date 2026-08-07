// PERF-A3 — recharts isolated so ProcessLineLiveDashboard can load without it (e.g. HRS).
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

export function PklMhTankTempsChart({
  data,
}: {
  data: Array<Record<string, number | string>>;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 h-64 shadow-sm">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground mb-2">Tank temps</p>
      <ResponsiveContainer width="100%" height="90%">
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis dataKey="time" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          <Legend />
          <Area type="monotone" dataKey="t1Temp" name="T1 °C" stroke="var(--color-chart-1)" fill="color-mix(in oklab, var(--color-chart-1) 20%, transparent)" />
          <Area type="monotone" dataKey="t2Temp" name="T2 °C" stroke="var(--color-chart-4)" fill="color-mix(in oklab, var(--color-chart-4) 20%, transparent)" />
          <Area type="monotone" dataKey="t3Temp" name="T3 °C" stroke="var(--color-chart-2)" fill="color-mix(in oklab, var(--color-chart-2) 20%, transparent)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
