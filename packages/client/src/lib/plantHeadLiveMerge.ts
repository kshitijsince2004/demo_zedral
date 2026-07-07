import type { LiveKpis, LiveOrderRow, MachineStatusCard } from '@m1/shared-validation';
import type { ExtendedPlantHeadDashboardData } from './reportingService';

function buildOpsFeedFromLive(
  machines: MachineStatusCard[],
  orders: LiveOrderRow[],
): ExtendedPlantHeadDashboardData['opsFeed'] {
  const feed: ExtendedPlantHeadDashboardData['opsFeed'] = [];

  for (const m of machines) {
    if (m.status === 'STOPPAGE' || m.status === 'BREAKDOWN') {
      feed.push({
        id: `stoppage-${m.machineCode}-${m.stateSinceAt ?? 'now'}`,
        timestamp: m.stateSinceAt
          ? new Date(m.stateSinceAt).toLocaleTimeString()
          : new Date().toLocaleTimeString(),
        machine: m.machineName,
        order: m.currentOrder ?? undefined,
        description: m.activeStoppageReason ?? `${m.status} on ${m.machineName}`,
        priority: m.status === 'BREAKDOWN' ? 'Critical' : 'High',
      });
    } else if (m.status === 'RUNNING' && m.currentOrder) {
      feed.push({
        id: `running-${m.machineCode}-${m.currentOrder}`,
        timestamp: m.lastUpdateAt
          ? new Date(m.lastUpdateAt).toLocaleTimeString()
          : new Date().toLocaleTimeString(),
        machine: m.machineName,
        order: m.currentOrder,
        description: `Production running${m.productionWeightMt != null ? ` · ${m.productionWeightMt} MT` : ''}`,
        priority: 'Medium',
      });
    }
  }

  for (const o of orders) {
    if (o.status !== 'STOPPAGE') continue;
    if (feed.some((e) => e.order === o.batchNumber)) continue;
    feed.push({
      id: `order-stoppage-${o.batchNumber}`,
      timestamp: new Date().toLocaleTimeString(),
      machine: o.machineName,
      order: o.batchNumber,
      description: `Order stoppage · ${o.customer}`,
      priority: 'High',
    });
  }

  return feed.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

/** Overlay live snapshot metrics onto plant-head reporting payload (single source of truth for “now”). */
export function mergePlantHeadWithLive(
  data: ExtendedPlantHeadDashboardData,
  liveKpis?: LiveKpis,
  liveMachines?: MachineStatusCard[],
  liveOrders?: LiveOrderRow[],
): ExtendedPlantHeadDashboardData {
  const opsFeed = liveMachines?.length
    ? buildOpsFeedFromLive(liveMachines, liveOrders ?? [])
    : data.opsFeed;

  if (!liveKpis) {
    return { ...data, opsFeed };
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
