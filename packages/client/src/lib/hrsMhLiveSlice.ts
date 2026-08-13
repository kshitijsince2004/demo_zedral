export type HrsLiveTab =
  | 'overview'
  | 'orders'
  | 'production'
  | 'rejected'
  | 'stoppages'
  | 'completed';

export const HRS_LIVE_TABS: { id: HrsLiveTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'production', label: 'Production' },
  { id: 'rejected', label: 'Order Hold' },
  { id: 'stoppages', label: 'Stoppage' },
  { id: 'completed', label: 'History' },
];

export const HRS_ORDER_TABS: HrsLiveTab[] = [
  'orders',
  'production',
  'rejected',
  'stoppages',
  'completed',
];

const ORDER_STATUSES = new Set(['PENDING', 'PREPARING']);

export function sliceHrsQueue<T extends { status: string }>(queue: T[], tab: HrsLiveTab): T[] {
  if (tab === 'orders') {
    return queue.filter((c) => ORDER_STATUSES.has(c.status.toUpperCase()));
  }
  if (tab === 'rejected') {
    const u = (s: string) => s.toUpperCase();
    return queue.filter((c) => u(c.status) === 'REJECTED' || u(c.status) === 'HOLD');
  }
  if (tab === 'completed') {
    return queue.filter((c) => c.status.toUpperCase() === 'COMPLETED');
  }
  return queue;
}

export function filterHrsSearch<T extends {
  coilNo: string;
  motherCoilNo?: string;
  slitId?: string;
  gradeCode?: string;
  customerName?: string;
  batchNumber?: string;
}>(rows: T[], q: string): T[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((c) =>
    [c.coilNo, c.motherCoilNo, c.slitId, c.gradeCode, c.customerName, c.batchNumber]
      .join(' ')
      .toLowerCase()
      .includes(needle),
  );
}

export type HrsLineStatus = 'RUNNING' | 'IDLE' | 'STOPPAGE';

export function hrsLineStatus(
  queue: Array<{ status: string }>,
  stoppageActive: boolean,
): HrsLineStatus {
  if (queue.some((c) => c.status === 'IN_PROGRESS')) return 'RUNNING';
  if (queue.some((c) => c.status === 'STOPPAGE') || stoppageActive) return 'STOPPAGE';
  return 'IDLE';
}

export function hrsLiveKpis(
  queue: Array<{ status: string }>,
  stoppageActive: boolean,
): { running: number; idle: number; stoppages: number; activeOrders: number } {
  const running = queue.some((c) => c.status === 'IN_PROGRESS') ? 1 : 0;
  const stoppages = queue.filter((c) => c.status === 'STOPPAGE').length + (stoppageActive ? 1 : 0);
  const activeOrders = sliceHrsQueue(queue, 'orders').length;
  return {
    running,
    idle: running === 0 && stoppages === 0 ? 1 : 0,
    stoppages,
    activeOrders,
  };
}
