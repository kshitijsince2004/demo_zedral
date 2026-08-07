// PERF-A3 — recharts report panels; parent loads this only after a report exists.
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartTooltip } from '../../../components/analytics/ChartTooltip';
import { ChartPanel } from '../../../components/analytics/ChartPanel';
import { MeasuredChart } from '../../../components/analytics/MeasuredChart';
import { DataUnavailable } from '../../../components/plant-head/DataUnavailable';
import { num, toChartLabel, type Reading } from '../../../lib/annReportUtils';

export function AnnMhReportCharts({
  readingsInWindow,
  chargeTempAvg,
  heatingReadings,
  coolingReadings,
}: {
  readingsInWindow: Reading[];
  chargeTempAvg: number | null;
  heatingReadings: Reading[];
  coolingReadings: Reading[];
}) {
  const hasReadings = readingsInWindow.length > 0;

  return (
    <div className="contents">
      <ChartPanel title="Temperature Trend">
        <div className="h-64">
          {hasReadings ? (
            <MeasuredChart minHeight={220}>
              {({ width, height }) => (
                <ResponsiveContainer width={width} height={height}>
                  <LineChart
                    data={readingsInWindow.map((r) => ({
                      t: toChartLabel(r.taken_at),
                      charge: num(r.charge_temp),
                      gas: num(r.gas_temp),
                    }))}
                    margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="t" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {chargeTempAvg != null && (
                      <ReferenceLine y={chargeTempAvg} stroke="hsl(var(--chart-2))" strokeDasharray="3 3" />
                    )}
                    <Line type="monotone" dataKey="charge" stroke="var(--color-chart-1)" strokeWidth={2} name="Charge temp" dot={false} />
                    <Line type="monotone" dataKey="gas" stroke="var(--color-chart-2)" strokeWidth={2} name="Gas temp" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </MeasuredChart>
          ) : (
            <DataUnavailable message="No readings available in range." />
          )}
        </div>
      </ChartPanel>

      <ChartPanel title="Base Temperature">
        {hasReadings ? (
          <div className="h-64">
            <MeasuredChart minHeight={220}>
              {({ width, height }) => (
                <ResponsiveContainer width={width} height={height}>
                  <LineChart data={readingsInWindow.map((r) => ({ t: toChartLabel(r.taken_at), v: num(r.fc_temp) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="t" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="v" stroke="var(--color-chart-4)" strokeWidth={2} dot={false} name="Base temp" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </MeasuredChart>
          </div>
        ) : (
          <DataUnavailable message="No data" />
        )}
      </ChartPanel>

      <ChartPanel title="Fan RPM">
        {hasReadings ? (
          <div className="h-64">
            <MeasuredChart minHeight={220}>
              {({ width, height }) => (
                <ResponsiveContainer width={width} height={height}>
                  <LineChart data={readingsInWindow.map((r) => ({ t: toChartLabel(r.taken_at), v: num(r.base_fan_rpm) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="t" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="v" stroke="var(--color-chart-5)" strokeWidth={2} dot={false} name="Fan RPM" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </MeasuredChart>
          </div>
        ) : (
          <DataUnavailable message="No data" />
        )}
      </ChartPanel>

      <ChartPanel title="Pressure">
        {hasReadings ? (
          <div className="h-64">
            <MeasuredChart minHeight={220}>
              {({ width, height }) => (
                <ResponsiveContainer width={width} height={height}>
                  <LineChart data={readingsInWindow.map((r) => ({ t: toChartLabel(r.taken_at), v: num(r.base_press) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="t" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="v" stroke="var(--color-primary)" strokeWidth={2} dot={false} name="Pressure" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </MeasuredChart>
          </div>
        ) : (
          <DataUnavailable message="No data" />
        )}
      </ChartPanel>

      <ChartPanel title="N2/H2 Flow">
        {hasReadings ? (
          <div className="h-64">
            <MeasuredChart minHeight={220}>
              {({ width, height }) => (
                <ResponsiveContainer width={width} height={height}>
                  <LineChart data={readingsInWindow.map((r) => ({ t: toChartLabel(r.taken_at), v: num(r.n2h2_flow) }))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="t" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="v" stroke="var(--color-chart-3)" strokeWidth={2} dot={false} name="N2/H2 flow" />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </MeasuredChart>
          </div>
        ) : (
          <DataUnavailable message="No data" />
        )}
      </ChartPanel>

      <ChartPanel title="Heating Curve">
        {heatingReadings.length === 0 ? (
          <DataUnavailable message="No heating stage data found." />
        ) : (
          <div className="h-64">
            <MeasuredChart minHeight={220}>
              {({ width, height }) => (
                <ResponsiveContainer width={width} height={height}>
                  <AreaChart
                    data={heatingReadings.map((r) => ({ t: toChartLabel(r.taken_at), v: num(r.charge_temp) }))}
                    margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
                  >
                    <defs>
                      <linearGradient id="heatGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-chart-1)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="t" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="v" stroke="var(--color-chart-1)" fill="url(#heatGrad)" strokeWidth={2} name="Heating (charge temp)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </MeasuredChart>
          </div>
        )}
      </ChartPanel>

      <ChartPanel title="Cooling Curve">
        {coolingReadings.length === 0 ? (
          <DataUnavailable message="No cooling stage data found." />
        ) : (
          <div className="h-64">
            <MeasuredChart minHeight={220}>
              {({ width, height }) => (
                <ResponsiveContainer width={width} height={height}>
                  <AreaChart
                    data={coolingReadings.map((r) => ({ t: toChartLabel(r.taken_at), v: num(r.charge_temp) }))}
                    margin={{ top: 10, right: 10, bottom: 0, left: 0 }}
                  >
                    <defs>
                      <linearGradient id="coolGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-chart-4)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--color-chart-4)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="t" tick={{ fontSize: 9 }} />
                    <YAxis tick={{ fontSize: 9 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="v" stroke="var(--color-chart-4)" fill="url(#coolGrad)" strokeWidth={2} name="Cooling (charge temp)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </MeasuredChart>
          </div>
        )}
      </ChartPanel>
    </div>
  );
}
