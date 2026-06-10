import React from 'react';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import { DataUnavailable } from './DataUnavailable';
import {
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

interface PlantQualityDowntimeAreaProps {
  data: ExtendedPlantHeadDashboardData;
}

function IntelligencePanelHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="px-5 py-4 border-b border-border/50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div>
        <h2 className="font-semibold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
}

export function PlantQualityDowntimeArea({ data }: PlantQualityDowntimeAreaProps) {
  const qualityTrendData = data.qualityTrend.map((point) => ({
    date: point.date,
    rejectionRatePct: point.rejectionRatePct,
    yieldPct: point.yieldPct,
  }));

  const topDowntime = data.downtimeDrivers[0];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <IntelligencePanelHeader
          title="Defect Intelligence"
          subtitle="Counts from defect entries · quality trend from shift loss"
        />
        <div className="p-5 flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col">
            <h3 className="text-xs font-semibold text-muted-foreground mb-4">Top Defects</h3>
            {data.defectsByCategory.length > 0 ? (
              <div className="flex-1 min-h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.defectsByCategory} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      dataKey="category"
                      type="category"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                      width={80}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} name="Count" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <DataUnavailable message="No defect records in the selected window." className="min-h-[200px]" />
            )}
          </div>

          <div className="flex flex-col">
            <h3 className="text-xs font-semibold text-muted-foreground mb-4">Rejection Rate Trend</h3>
            {qualityTrendData.length > 0 ? (
              <div className="flex-1 min-h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={qualityTrendData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                      domain={[0, 100]}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: '11px' }} />
                    <Line
                      type="monotone"
                      dataKey="rejectionRatePct"
                      stroke="hsl(var(--info))"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name="Rejection %"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <DataUnavailable message="No quality trend data for the selected window." className="min-h-[200px]" />
            )}
          </div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <IntelligencePanelHeader
          title="Downtime Intelligence"
          subtitle="Stoppage minutes by reason from shift logs"
        />
        <div className="p-5 flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="flex flex-col">
            <h3 className="text-xs font-semibold text-muted-foreground mb-4">Downtime Reasons</h3>
            {data.downtimeByCategory.length > 0 ? (
              <div className="flex-1 min-h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.downtimeByCategory} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      dataKey="category"
                      type="category"
                      tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                      axisLine={false}
                      tickLine={false}
                      width={80}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        borderColor: 'hsl(var(--border))',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar dataKey="minutes" fill="hsl(var(--warning) / 0.55)" radius={[0, 4, 4, 0]} name="Minutes" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <DataUnavailable message="No stoppage records in the selected window." className="min-h-[200px]" />
            )}
          </div>

          <div className="flex flex-col gap-4">
            <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
              <span className="text-xs font-medium text-muted-foreground block mb-1">
                MTTR (Mean Time To Repair)
              </span>
              <span className="text-sm text-muted-foreground italic">Not available — repair interval telemetry not configured</span>
            </div>
            <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
              <span className="text-xs font-medium text-muted-foreground block mb-1">
                MTBF (Mean Time Between Failures)
              </span>
              <span className="text-sm text-muted-foreground italic">Not available — failure interval telemetry not configured</span>
            </div>
            <div className="bg-muted/30 rounded-lg p-4 border border-border/50">
              <span className="text-xs font-medium text-muted-foreground block mb-1">Top Downtime Driver</span>
              {topDowntime ? (
                <span className="text-sm font-semibold text-foreground">
                  {topDowntime.reason} · {topDowntime.totalMinutes} min ({topDowntime.occurrences} events)
                </span>
              ) : (
                <span className="text-sm text-muted-foreground italic">Not available</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
