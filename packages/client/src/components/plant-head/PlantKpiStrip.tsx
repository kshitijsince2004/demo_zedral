import React from 'react';
import type { LiveKpis } from '@m1/shared-validation';
import {
  formatTrendPct,
  type ExtendedPlantHeadDashboardData,
} from '../../lib/reportingService';

interface PlantKpiStripProps {
  data: ExtendedPlantHeadDashboardData;
  liveKpis?: LiveKpis;
  onBacklogClick?: () => void;
}

interface KpiTile {
  label: string;
  value: string;
  trend: string | null;
  /** Highlights the value (e.g. pending backlog). */
  emphasis?: 'warning';
  onClick?: () => void;
}

export function PlantKpiStrip({ data, liveKpis, onBacklogClick }: PlantKpiStripProps) {
  const strip = data.kpiStrip;
  const productionTodayMt = liveKpis?.productionTodayMt ?? strip.productionTodayMt;

  const kpis: KpiTile[] = [
    {
      label: "Production Today",
      value: `${Math.round(productionTodayMt)} MT`,
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
      value: liveKpis?.shiftTargetMt
        ? `${Math.round(liveKpis.shiftPerformancePct)}%`
        : `${strip.performancePct}%`,
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
    {
      label: 'Backlog',
      value: `${data.backlogCount} ${data.backlogCount === 1 ? 'order' : 'orders'}`,
      trend: null,
      emphasis: data.backlogCount > 0 ? 'warning' : undefined,
      onClick: onBacklogClick,
    },
  ];

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 xl:grid-cols-7 gap-4"
      data-testid="plant-kpi-strip"
      role="group"
      aria-label="Plant KPI summary"
    >
      {kpis.map((kpi) => {
        const isNegative = kpi.trend?.startsWith('-') ?? false;
        const isNeutral = kpi.trend === '0%';
        const TileTag = kpi.onClick ? 'button' : 'div';
        return (
          <TileTag
            key={kpi.label}
            type={kpi.onClick ? 'button' : undefined}
            onClick={kpi.onClick}
            className={[
              'bg-card text-card-foreground border border-border rounded-lg p-6 shadow-sm flex flex-col text-left',
              kpi.onClick ? 'cursor-pointer hover:bg-secondary/40 transition-colors focus:outline-none focus:ring-2 focus:ring-ring/30' : '',
            ].join(' ')}
            data-testid={kpi.label === 'Backlog' ? 'plant-kpi-backlog' : undefined}
          >
            <span className="text-sm font-medium text-muted-foreground mb-1">{kpi.label}</span>
            <div className="flex items-baseline gap-2 mt-auto">
              <span
                className={`text-2xl font-bold ${
                  kpi.emphasis === 'warning' ? 'text-destructive' : 'text-foreground'
                }`}
              >
                {kpi.value}
              </span>
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
          </TileTag>
        );
      })}
    </div>
  );
}
