import type { SixHiOrderDetail } from '@m1/shared-validation';

/** Sum recorded + live stoppage milliseconds for an order. */
export function totalStoppageMs(order: SixHiOrderDetail, includeActive = true): number {
  let ms = 0;
  for (const s of order.stoppages ?? []) {
    if (s.durationMin != null) {
      ms += s.durationMin * 60_000;
    } else if (s.endAt) {
      ms += Math.max(0, new Date(s.endAt).getTime() - new Date(s.startAt).getTime());
    } else if (includeActive) {
      ms += Math.max(0, Date.now() - new Date(s.startAt).getTime());
    }
  }
  return ms;
}

/** Wall-clock production time minus stoppage time. */
export function netProductionRuntimeMs(order: SixHiOrderDetail): number | null {
  if (!order.prodStartAt) return null;
  const endMs = order.prodEndAt ? new Date(order.prodEndAt).getTime() : Date.now();
  const wall = endMs - new Date(order.prodStartAt).getTime();
  // Always deduct open stoppage time so the production timer freezes while stopped.
  const deductActive = order.status === 'STOPPAGE' || !!order.activeStoppage;
  return Math.max(0, wall - totalStoppageMs(order, deductActive));
}

export function formatRuntimeMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function canRecordStoppage(order: SixHiOrderDetail | null | undefined): boolean {
  if (!order) return false;
  if (order.activeStoppage) return true;
  return order.status === 'IN_PROGRESS' || order.status === 'STOPPAGE';
}
