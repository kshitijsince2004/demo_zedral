import type { LiveKpis } from '@m1/shared-validation';
import type { PlantHeadDashboardData } from './reportingService';
import { formatTrendPct } from './reportingService';

export interface ExecutiveInsightRow {
  label: string;
  value: string | null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Insights derived from plant-head API plus optional live capture metrics. */
export function buildExecutiveInsights(
  data: PlantHeadDashboardData,
  liveKpis?: LiveKpis,
): ExecutiveInsightRow[] {
  const totalActual = data.productionVsPlan.reduce((sum, row) => sum + row.actual, 0);
  const totalPlanned = data.productionVsPlan.reduce((sum, row) => sum + row.planned, 0);

  const planAttainmentPct =
    totalPlanned > 0 ? round1(Math.min((totalActual / totalPlanned) * 100, 100)) : null;
  const productionTrend = formatTrendPct(data.kpiStrip.productionTodayTrendPct);

  const linesWithPlan = data.productionVsPlan.filter((line) => line.planned > 0);
  const lowestAttainment = linesWithPlan.length
    ? [...linesWithPlan].sort((a, b) => a.attainmentPct - b.attainmentPct)[0]
    : null;

  const topDefect = data.topDefects[0];
  const linesBelowTarget = linesWithPlan.filter((line) => line.attainmentPct < 90).length;

  const rows: ExecutiveInsightRow[] = [
    ...(liveKpis?.shiftLogId
      ? [{
          label: 'Current shift production (live)',
          value: liveKpis.shiftTargetMt > 0
            ? `${round1(liveKpis.shiftProductionMt)} / ${round1(liveKpis.shiftTargetMt)} MT · ${round1(liveKpis.shiftPerformancePct)}%`
            : `${round1(liveKpis.shiftProductionMt)} MT captured`,
        }]
      : []),
    {
      label: 'Production vs plan (window)',
      value:
        planAttainmentPct != null
          ? `${planAttainmentPct}% attainment${productionTrend ? ` · today ${productionTrend}` : ''}`
          : null,
    },
    {
      label: 'Lowest attainment line',
      value: lowestAttainment
        ? `${lowestAttainment.lineName} · ${lowestAttainment.attainmentPct}% of plan`
        : null,
    },
    {
      label: 'Top defect (reporting window)',
      value: topDefect
        ? `${topDefect.defectName || topDefect.defectCode} · ${topDefect.count} recorded`
        : null,
    },
    {
      label: 'Lines below 90% plan attainment',
      value: linesWithPlan.length > 0 ? `${linesBelowTarget} of ${linesWithPlan.length}` : null,
    },
  ];

  return rows;
}
