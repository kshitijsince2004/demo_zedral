import React from 'react';
import type { LiveKpis } from '@m1/shared-validation';
import {
  formatTrendPct,
  type ExtendedPlantHeadDashboardData,
} from '../../lib/reportingService';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Gauge,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react';

interface PlantKpiStripProps {
  data: ExtendedPlantHeadDashboardData;
  liveKpis?: LiveKpis;
}

interface KpiTile {
  label: string;
  value: string;
  numericValue: number;
  trend: string | null;
  icon: React.ReactNode;
  accent: string;
  isLive?: boolean;
}

export function PlantKpiStrip({ data, liveKpis }: PlantKpiStripProps) {
  const strip = data.kpiStrip;
  const utilizationPct = liveKpis?.utilizationPct ?? strip.utilizationPct;
  const utilizationTrend = formatTrendPct(strip.utilizationTrendPct);

  const kpis: KpiTile[] = [
    {
      label: 'Production Today',
      value: `${Math.round(strip.productionTodayMt)} MT`,
      numericValue: Math.min((strip.productionTodayMt / (data.productionTarget || 1)) * 100, 100),
      trend: formatTrendPct(strip.productionTodayTrendPct),
      icon: <BarChart3 className="w-4 h-4" />,
      accent: 'blue',
    },
    {
      label: 'OEE',
      value: `${strip.oeePct}%`,
      numericValue: strip.oeePct,
      trend: formatTrendPct(strip.oeeTrendPct),
      icon: <Gauge className="w-4 h-4" />,
      accent: strip.oeePct >= 75 ? 'green' : strip.oeePct >= 55 ? 'amber' : 'red',
    },
    {
      label: 'Availability',
      value: `${strip.availabilityPct}%`,
      numericValue: strip.availabilityPct,
      trend: formatTrendPct(strip.availabilityTrendPct),
      icon: <CheckCircle2 className="w-4 h-4" />,
      accent: strip.availabilityPct >= 80 ? 'green' : strip.availabilityPct >= 60 ? 'amber' : 'red',
    },
    {
      label: 'Performance',
      value: `${strip.performancePct}%`,
      numericValue: strip.performancePct,
      trend: formatTrendPct(strip.performanceTrendPct),
      icon: <Zap className="w-4 h-4" />,
      accent: strip.performancePct >= 80 ? 'green' : strip.performancePct >= 60 ? 'amber' : 'red',
    },
    {
      label: 'Quality',
      value: `${strip.qualityPct}%`,
      numericValue: strip.qualityPct,
      trend: formatTrendPct(strip.qualityTrendPct),
      icon: <CheckCircle2 className="w-4 h-4" />,
      accent: strip.qualityPct >= 95 ? 'green' : strip.qualityPct >= 85 ? 'amber' : 'red',
    },
    {
      label: 'Utilization',
      value: `${utilizationPct}%`,
      numericValue: utilizationPct,
      trend: utilizationTrend,
      icon: <Activity className="w-4 h-4" />,
      accent: 'purple',
      isLive: !!liveKpis,
    },
  ];

  const accentStyles: Record<string, { bar: string; icon: string; border: string }> = {
    blue: { bar: 'bg-blue-500', icon: 'text-blue-500 bg-blue-50', border: 'border-t-blue-500' },
    green: { bar: 'bg-emerald-500', icon: 'text-emerald-600 bg-emerald-50', border: 'border-t-emerald-500' },
    amber: { bar: 'bg-amber-500', icon: 'text-amber-600 bg-amber-50', border: 'border-t-amber-500' },
    red: { bar: 'bg-red-500', icon: 'text-red-600 bg-red-50', border: 'border-t-red-500' },
    purple: { bar: 'bg-violet-500', icon: 'text-violet-600 bg-violet-50', border: 'border-t-violet-500' },
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {kpis.map((kpi) => {
        const isNegative = kpi.trend?.startsWith('-') ?? false;
        const isNeutral = !kpi.trend || kpi.trend === '0%';
        const styles = accentStyles[kpi.accent] ?? accentStyles.blue;

        return (
          <div
            key={kpi.label}
            className={`bg-white border border-border rounded-xl shadow-sm flex flex-col overflow-hidden border-t-2 ${styles.border}`}
          >
            <div className="px-4 pt-4 pb-3 flex-1 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider leading-tight">
                  {kpi.label}
                </span>
                <div className={`p-1.5 rounded-lg ${styles.icon}`}>
                  {kpi.icon}
                </div>
              </div>

              <div className="flex items-end justify-between gap-1">
                <span className="text-2xl font-bold text-foreground leading-none">{kpi.value}</span>
                {kpi.trend && !isNeutral ? (
                  <span className={`flex items-center gap-0.5 text-xs font-semibold pb-0.5 ${isNegative ? 'text-red-500' : 'text-emerald-600'}`}>
                    {isNegative ? <TrendingDown className="w-3 h-3" /> : <TrendingUp className="w-3 h-3" />}
                    {kpi.trend}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground pb-0.5">—</span>
                )}
              </div>

              <div className="space-y-1">
                <div className="h-1.5 bg-muted/40 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${styles.bar}`}
                    style={{ width: `${Math.max(0, Math.min(100, kpi.numericValue))}%` }}
                  />
                </div>
                {kpi.isLive && (
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-[10px] text-emerald-600 font-medium">Live</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
