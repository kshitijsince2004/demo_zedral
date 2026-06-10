import React from 'react';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import { buildExecutiveInsights } from '../../lib/plantHeadInsights';
import { DataUnavailable } from './DataUnavailable';
import { ChartTooltip } from '../analytics/ChartTooltip';
import { AlertCircle, CheckCircle2, TrendingDown, TrendingUp } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface PlantMainOpsAreaProps {
  data: ExtendedPlantHeadDashboardData;
}

const C = {
  blue: '#3b82f6',
  blueLight: '#93c5fd',
  emerald: '#10b981',
  amber: '#f59e0b',
  slate: '#94a3b8',
  indigo: '#6366f1',
  grid: '#e2e8f0',
  text: '#94a3b8',
};



export function PlantMainOpsArea({ data }: PlantMainOpsAreaProps) {
  const insights = buildExecutiveInsights(data);
  const hasInsight = insights.some((row) => row.value != null);
  const hasDailyProduction = data.productionVsTarget.length > 0;
  const hasOeeTrend = data.oeeTrend && data.oeeTrend.length > 0;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-10 gap-4">
      <div className="lg:col-span-7 bg-card text-card-foreground border border-border rounded-lg shadow-sm flex flex-col overflow-hidden">
        <div className="p-6 flex items-center justify-between">
          <div className="flex flex-col space-y-1.5">
            <h2 className="font-semibold leading-none tracking-tight text-foreground">Production Performance</h2>
            <p className="text-sm text-muted-foreground">Daily actual vs target · from shift logs</p>
          </div>
          {data.productionTrend && (
            <div className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${
              data.productionTrend.startsWith('-')
                ? 'bg-destructive/10 text-destructive'
                : 'bg-success/10 text-success'
            }`}>
              {data.productionTrend.startsWith('-')
                ? <TrendingDown className="w-3 h-3" />
                : <TrendingUp className="w-3 h-3" />}
              {data.productionTrend}
            </div>
          )}
        </div>

        <div className="p-6 pt-0 flex flex-col gap-6 flex-1">
          {hasDailyProduction ? (
            <div className="flex flex-col">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
                Production vs Target (MT)
              </h3>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.productionVsTarget} barGap={2}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.grid} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: C.text }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: C.text }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }}
                      iconType="circle"
                      iconSize={8}
                    />
                    <Bar dataKey="targetMt" fill={C.slate} radius={[3, 3, 0, 0]} name="Target MT" opacity={0.5} />
                    <Bar dataKey="actualMt" fill={C.blue} radius={[3, 3, 0, 0]} name="Actual MT" />
                    <Line
                      type="monotone"
                      dataKey="actualMt"
                      stroke={C.emerald}
                      strokeWidth={2}
                      dot={{ r: 3, fill: C.emerald, strokeWidth: 0 }}
                      name="Trend"
                      legendType="none"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <DataUnavailable message="No daily production data for the selected window." />
          )}

          {hasOeeTrend && (
            <div className="flex flex-col border-t border-border/40 pt-5">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
                OEE Trend (%)
              </h3>
              <div className="h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.oeeTrend}>
                    <defs>
                      <linearGradient id="oeeGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.indigo} stopOpacity={0.2} />
                        <stop offset="95%" stopColor={C.indigo} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.grid} />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: C.text }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: C.text }}
                      axisLine={false}
                      tickLine={false}
                      domain={[0, 100]}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="oee"
                      stroke={C.indigo}
                      strokeWidth={2}
                      fill="url(#oeeGrad)"
                      dot={{ r: 2.5, fill: C.indigo, strokeWidth: 0 }}
                      name="OEE %"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="lg:col-span-3 bg-card text-card-foreground border border-border rounded-lg shadow-sm flex flex-col">
        <div className="p-6 flex flex-col space-y-1.5 border-b border-border/50">
          <h2 className="font-semibold leading-none tracking-tight text-foreground">Executive Insights</h2>
          <p className="text-sm text-muted-foreground">From plant reporting API</p>
        </div>
        <div className="flex-1 p-0">
          {hasInsight ? (
            <ul className="divide-y divide-border/40">
              {insights.map((row) => {
                const isGood = row.value && !row.value.includes('0 of') && !row.value.includes('below');
                const isBad = row.value && (row.value.includes(' of ') && row.label.includes('below'));
                return (
                  <li key={row.label} className="px-5 py-4 flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      {isBad ? (
                        <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                      )}
                      <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        {row.label}
                      </span>
                    </div>
                    {row.value ? (
                      <span className="text-sm font-semibold text-foreground pl-5">{row.value}</span>
                    ) : (
                      <span className="text-sm text-muted-foreground italic pl-5">Not available</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <DataUnavailable message="Insufficient shift-log data to generate executive insights." />
          )}
        </div>

        {(data.runningMachines != null || data.breakdownMachines != null) && (
          <div className="px-5 py-4 border-t border-border/50 grid grid-cols-2 gap-3">
            <div className="bg-success/10 rounded-lg p-3 text-center border border-success/20">
              <div className="text-xl font-bold text-success">{data.runningMachines ?? 0}</div>
              <div className="text-[10px] font-semibold text-success uppercase tracking-wide mt-0.5">Running</div>
            </div>
            <div className="bg-destructive/10 rounded-lg p-3 text-center border border-destructive/20">
              <div className="text-xl font-bold text-destructive">{data.breakdownMachines ?? 0}</div>
              <div className="text-[10px] font-semibold text-destructive uppercase tracking-wide mt-0.5">Breakdown</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
