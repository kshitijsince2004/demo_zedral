import React from 'react';
import type { LiveKpis } from '@m1/shared-validation';
import type { ExtendedPlantHeadDashboardData } from '../../lib/reportingService';

interface PlantKpiStripProps {
  data: ExtendedPlantHeadDashboardData;
  liveKpis?: LiveKpis;
}

export function PlantKpiStrip({ data, liveKpis }: PlantKpiStripProps) {
  const runningOrders = liveKpis?.activeOrders ?? data.runningOrders;
  const utilizationPct = liveKpis?.utilizationPct ?? data.overallUtilizationPct;
  const activeAlerts = liveKpis
    ? liveKpis.breakdownMachines + liveKpis.currentStoppages
    : data.activeAlerts;

  const kpis = [
    { label: "Today's Production", value: `${data.productionTodayMt} MT`, trend: data.productionTrend },
    { label: "Current Shift", value: `${data.shiftProductionMt} MT`, trend: '+1.2%' },
    { label: "Plant Utilization", value: `${utilizationPct}%`, trend: liveKpis ? 'Live' : '+0.5%' },
    { label: "OEE", value: `${data.oeePct}%`, trend: '-0.3%' },
    { label: "Running Orders", value: runningOrders, trend: liveKpis ? `${liveKpis.runningMachines} machines` : null },
    { label: "Active Alerts", value: activeAlerts, trend: liveKpis ? `${liveKpis.currentStoppages} stoppages` : null },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {kpis.map((kpi, idx) => {
        const isNegative = kpi.trend && kpi.trend.startsWith('-');
        return (
          <div key={idx} className="bg-card border border-border rounded-xl p-4 shadow-sm flex flex-col">
            <span className="text-xs font-semibold text-muted-foreground mb-1">{kpi.label}</span>
            <div className="flex items-baseline gap-2 mt-auto">
              <span className="text-2xl font-bold text-foreground">{kpi.value}</span>
              {kpi.trend && (
                <span className={`text-xs font-medium ${isNegative ? 'text-destructive' : 'text-success'}`}>
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
