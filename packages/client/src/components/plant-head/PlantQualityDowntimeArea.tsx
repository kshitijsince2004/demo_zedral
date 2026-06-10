import React from 'react';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';
import { DataUnavailable } from './DataUnavailable';
import { AlertTriangle, Clock, TrendingDown } from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface PlantQualityDowntimeAreaProps {
  data: ExtendedPlantHeadDashboardData;
}

const C = {
  blue: '#3b82f6',
  emerald: '#10b981',
  amber: '#f59e0b',
  red: '#ef4444',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  slate: '#94a3b8',
  grid: '#e2e8f0',
  text: '#94a3b8',
};

const DOWNTIME_COLORS = [C.amber, '#fbbf24', '#fcd34d', '#fde68a', '#fef3c7'];
const DEFECT_COLORS = [C.red, '#f87171', '#fca5a5', '#fecaca', '#fee2e2'];

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-border rounded-xl shadow-lg px-4 py-3 text-xs">
      <div className="font-semibold text-foreground mb-2">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground">{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</span>
        </div>
      ))}
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
  const totalDowntimeMin = data.downtimeByCategory.reduce((s, d) => s + d.minutes, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Quality */}
      <div className="bg-white border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-foreground">Quality Intelligence</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Defect counts · rejection & yield trends</p>
          </div>
          {data.defectPct != null && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-red-50">
              <TrendingDown className="w-3.5 h-3.5 text-red-500" />
              <span className="text-xs font-semibold text-red-600">{data.defectPct.toFixed(1)}% defect</span>
            </div>
          )}
        </div>

        <div className="p-5 flex-1 flex flex-col gap-5">
          {/* Top defects horizontal bars */}
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
              Top Defects
            </h3>
            {data.defectsByCategory.length > 0 ? (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.defectsByCategory.slice(0, 6)} layout="vertical" margin={{ left: 0, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={C.grid} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 10, fill: C.text }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      dataKey="category"
                      type="category"
                      tick={{ fontSize: 10, fill: C.text }}
                      axisLine={false}
                      tickLine={false}
                      width={72}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} name="Count">
                      {data.defectsByCategory.slice(0, 6).map((_, i) => (
                        <Cell key={i} fill={DEFECT_COLORS[Math.min(i, DEFECT_COLORS.length - 1)]} />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <DataUnavailable message="No defect records in the selected window." className="min-h-[176px]" />
            )}
          </div>

          {/* Rejection rate area chart */}
          <div className="border-t border-border/40 pt-4">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
              Rejection Rate Trend (%)
            </h3>
            {qualityTrendData.length > 0 ? (
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={qualityTrendData}>
                    <defs>
                      <linearGradient id="rejGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.red} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={C.red} stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="yieldGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={C.emerald} stopOpacity={0.15} />
                        <stop offset="95%" stopColor={C.emerald} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={C.grid} />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: C.text }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: C.text }} axisLine={false} tickLine={false} domain={[0, 100]} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="rejectionRatePct" stroke={C.red} strokeWidth={2} fill="url(#rejGrad)" dot={false} name="Rejection %" />
                    <Area type="monotone" dataKey="yieldPct" stroke={C.emerald} strokeWidth={2} fill="url(#yieldGrad)" dot={false} name="Yield %" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <DataUnavailable message="No quality trend data for the selected window." className="min-h-[128px]" />
            )}
          </div>
        </div>
      </div>

      {/* Downtime */}
      <div className="bg-white border border-border rounded-xl shadow-sm flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-border/50 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-foreground">Downtime Intelligence</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Stoppage minutes by reason</p>
          </div>
          {totalDowntimeMin > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-50">
              <Clock className="w-3.5 h-3.5 text-amber-500" />
              <span className="text-xs font-semibold text-amber-600">{totalDowntimeMin} min total</span>
            </div>
          )}
        </div>

        <div className="p-5 flex-1 flex flex-col gap-5">
          <div>
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-3">
              Downtime by Reason
            </h3>
            {data.downtimeByCategory.length > 0 ? (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.downtimeByCategory.slice(0, 6)} layout="vertical" margin={{ left: 0, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={C.grid} />
                    <XAxis type="number" tick={{ fontSize: 10, fill: C.text }} axisLine={false} tickLine={false} />
                    <YAxis
                      dataKey="category"
                      type="category"
                      tick={{ fontSize: 10, fill: C.text }}
                      axisLine={false}
                      tickLine={false}
                      width={72}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="minutes" radius={[0, 4, 4, 0]} name="Minutes">
                      {data.downtimeByCategory.slice(0, 6).map((_, i) => (
                        <Cell key={i} fill={DOWNTIME_COLORS[Math.min(i, DOWNTIME_COLORS.length - 1)]} />
                      ))}
                    </Bar>
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <DataUnavailable message="No stoppage records in the selected window." className="min-h-[176px]" />
            )}
          </div>

          {/* Key stats row */}
          <div className="border-t border-border/40 pt-4 grid grid-cols-1 gap-3">
            {topDowntime ? (
              <div className="flex items-start gap-3 bg-amber-50 rounded-lg p-3 border border-amber-100">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-amber-600 mb-0.5">
                    Top Downtime Driver
                  </div>
                  <div className="text-sm font-semibold text-foreground">
                    {topDowntime.reason}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {topDowntime.totalMinutes} min · {topDowntime.occurrences} event{topDowntime.occurrences !== 1 ? 's' : ''}
                    {topDowntime.type === 'UNPLANNED' && (
                      <span className="ml-2 text-red-500 font-medium">Unplanned</span>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div className="bg-slate-50 rounded-lg p-3 border border-border/50">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                  MTTR
                </div>
                {data.mttrHours != null && data.mttrHours > 0 ? (
                  <div className="text-sm font-semibold text-foreground">{data.mttrHours.toFixed(1)} hrs</div>
                ) : (
                  <div className="text-xs text-muted-foreground italic">Not configured</div>
                )}
              </div>
              <div className="bg-slate-50 rounded-lg p-3 border border-border/50">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                  MTBF
                </div>
                {data.mtbfHours != null && data.mtbfHours > 0 ? (
                  <div className="text-sm font-semibold text-foreground">{data.mtbfHours.toFixed(1)} hrs</div>
                ) : (
                  <div className="text-xs text-muted-foreground italic">Not configured</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
