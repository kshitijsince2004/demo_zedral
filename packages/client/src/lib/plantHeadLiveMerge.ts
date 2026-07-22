import type { LiveKpis, LiveOrderRow, MachineStatusCard } from '@m1/shared-validation';
import type { ExtendedPlantHeadDashboardData, OpsFeedEvent } from './reportingService';

function buildOpsFeedFromLive(
  machines: MachineStatusCard[],
  orders: LiveOrderRow[],
): OpsFeedEvent[] {
  const feed: OpsFeedEvent[] = [];

  for (const m of machines) {
    if (m.status === 'STOPPAGE' || m.status === 'BREAKDOWN') {
      feed.push({
        id: `stoppage-${m.machineCode}-${m.stateSinceAt ?? 'now'}`,
        timestamp: m.stateSinceAt ?? new Date().toISOString(),
        machine: m.machineName,
        order: m.currentOrder ?? undefined,
        description: m.activeStoppageReason ?? `${m.status} on ${m.machineName}`,
        priority: m.status === 'BREAKDOWN' ? 'Critical' : 'High',
      });
    } else if (m.status === 'RUNNING' && m.currentOrder) {
      feed.push({
        id: `running-${m.machineCode}-${m.currentOrder}`,
        timestamp: m.lastUpdateAt ?? new Date().toISOString(),
        machine: m.machineName,
        order: m.currentOrder,
        description: `Production running${m.productionWeightMt != null ? ` · ${m.productionWeightMt} MT` : ''}`,
        priority: 'Medium',
      });
    } else if (m.status === 'IDLE' && m.stateSinceAt) {
      feed.push({
        id: `idle-${m.machineCode}-${m.stateSinceAt}`,
        timestamp: m.stateSinceAt,
        machine: m.machineName,
        order: m.lastOrderBatchNumber ?? undefined,
        description: 'Machine idle',
        priority: 'Low',
      });
    }
  }

  for (const o of orders) {
    if (o.status !== 'STOPPAGE') continue;
    if (feed.some((e) => e.order === o.batchNumber)) continue;
    feed.push({
      id: `order-stoppage-${o.batchNumber}`,
      timestamp: new Date().toISOString(),
      machine: o.machineName,
      order: o.batchNumber,
      description: `Order stoppage · ${o.customer}`,
      priority: 'High',
    });
  }

  return feed.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function buildCriticalAlertsFromLive(machines: MachineStatusCard[]): string[] {
  return machines
    .filter((m) => m.status === 'BREAKDOWN' || m.status === 'STOPPAGE')
    .map((m) => {
      const reason = m.activeStoppageReason ?? m.status;
      return `${m.machineName}: ${reason}`;
    });
}

/** Overlay live snapshot metrics onto plant-head reporting payload (single source of truth for “now”). */
export function mergePlantHeadWithLive(
  data: ExtendedPlantHeadDashboardData,
  liveKpis?: LiveKpis,
  liveMachines?: MachineStatusCard[],
  liveOrders?: LiveOrderRow[],
): ExtendedPlantHeadDashboardData {
  const hasLiveMachines = (liveMachines?.length ?? 0) > 0;
  const opsFeed = hasLiveMachines
    ? buildOpsFeedFromLive(liveMachines!, liveOrders ?? [])
    : data.opsFeed;

  const liveCritical = hasLiveMachines
    ? buildCriticalAlertsFromLive(liveMachines!)
    : data.criticalAlerts;

  const liveStoppages = hasLiveMachines
    ? liveMachines!.filter((m) => m.status === 'STOPPAGE' || m.status === 'BREAKDOWN').length
    : data.activeAlerts;

  if (!liveKpis) {
    return {
      ...data,
      opsFeed,
      criticalAlerts: liveCritical.length > 0 ? liveCritical : data.criticalAlerts,
      activeAlerts: hasLiveMachines ? liveStoppages : data.activeAlerts,
      breakdownMachines: hasLiveMachines
        ? liveMachines!.filter((m) => m.status === 'BREAKDOWN').length
        : data.breakdownMachines,
    };
  }

  const productionTodayMt = liveKpis.productionTodayMt ?? data.kpiStrip.productionTodayMt;
  const shiftProductionMt = liveKpis.shiftProductionMt ?? data.shiftProductionMt;

  return {
    ...data,
    productionToday: productionTodayMt,
    productionTodayMt: Math.round(productionTodayMt),
    productionShift: shiftProductionMt,
    shiftProductionMt: Math.round(shiftProductionMt),
    runningMachines: liveKpis.runningMachines,
    breakdownMachines: liveKpis.breakdownMachines,
    runningOrders: liveKpis.activeOrders,
    activeAlerts: liveStoppages,
    criticalAlerts: liveCritical.length > 0 ? liveCritical : data.criticalAlerts,
    opsFeed,
    kpiStrip: {
      ...data.kpiStrip,
      productionTodayMt,
      performancePct:
        liveKpis.shiftTargetMt > 0
          ? Math.round(liveKpis.shiftPerformancePct)
          : data.kpiStrip.performancePct,
    },
  };
}
