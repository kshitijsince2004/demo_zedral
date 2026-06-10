import React from 'react';
import type { LiveKpis } from '@m1/shared-validation';
import {
  formatTrendPct,
  type ExtendedPlantHeadDashboardData,
} from '../../lib/reportingService';

interface PlantKpiStripProps {
  data: ExtendedPlantHeadDashboardData;
  liveKpis?: LiveKpis;
}

interface KpiTile {
  label: string;
  value: string;
  trend: string | null;
}

export function PlantKpiStrip({ data, liveKpis }: PlantKpiStripProps) {
  const strip = data.kpiStrip;

  const kpis: KpiTile[] = [
    {
      label: "Production Today",
      value: `${Math.round(strip.productionTodayMt)} MT`,
      trend: formatTrendPct(strip.productionTodayTrendPct),
    },
    {
      label: 'OEE',
      value: `${strip.oeePct}%`,
      trend: formatTrendPct(strip.oeeTrendPct),
    },
    {
      label: 'Availability',
      value: `${strip.availabilityPct}%`,
      trend: formatTrendPct(strip.availabilityTrendPct),
    },
    {
      label: 'Performance',
      value: `${strip.performancePct}%`,
      trend: formatTrendPct(strip.performanceTrendPct),
    },
    {
      label: 'Quality',
      value: `${strip.qualityPct}%`,
      trend: formatTrendPct(strip.qualityTrendPct),
    },
    {
      label: 'Machines Running',
      value: liveKpis != null ? `${liveKpis.machinesRunningPct}%` : '—',
      trend: null,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {kpis.map((kpi) => {
        const isNegative = kpi.trend?.startsWith('-') ?? false;
        const isNeutral = kpi.trend === '0%';
        return (
          <div
            key={kpi.label}
            className="bg-card text-card-foreground border border-border rounded-lg p-6 shadow-sm flex flex-col"
          >
            <span className="text-sm font-medium text-muted-foreground mb-1">{kpi.label}</span>
            <div className="flex items-baseline gap-2 mt-auto">
              <span className="text-2xl font-bold text-foreground">{kpi.value}</span>
              {kpi.trend && (
                <span
                  className={`text-xs font-medium ${
                    isNeutral
                      ? 'text-muted-foreground'
                      : isNegative
                        ? 'text-destructive'
                        : 'text-success'
                  }`}
                >
                  {kpi.trend}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
