import type { SixHiOrderDetail } from '@m1/shared-validation';
import { getServerTime } from './apiClient';

/** Sum recorded + live stoppage milliseconds for an order. */
export function totalStoppageMs(order: SixHiOrderDetail, includeActive = true): number {
  let ms = 0;
  const activeId = order.activeStoppage?.id;
  const now = getServerTime();
  for (const s of order.stoppages ?? []) {
    if (s.endAt) {
      ms += Math.max(0, new Date(s.endAt).getTime() - new Date(s.startAt).getTime());
    } else if (includeActive && activeId === s.id) {
      ms += Math.max(0, now - new Date(s.startAt).getTime());
    } else if (s.durationMin != null && s.durationMin > 0) {
      ms += s.durationMin * 60_000;
    }
  }
  return ms;
}

/** Wall-clock span from production start to end (or now). */
export function wallProductionMs(order: SixHiOrderDetail): number | null {
  if (!order.prodStartAt) return null;
  const endMs = order.prodEndAt ? new Date(order.prodEndAt).getTime() : getServerTime();
  return Math.max(0, endMs - new Date(order.prodStartAt).getTime());
}

/** Wall-clock production time minus stoppage time. */
export function netProductionRuntimeMs(order: SixHiOrderDetail): number | null {
  const wall = wallProductionMs(order);
  if (wall == null) return null;
  const deductActive = !!order.activeStoppage;
  return Math.max(0, wall - totalStoppageMs(order, deductActive));
}

/** Net production minutes — prefers stored prodDurationMin, else derives from timestamps. */
export function resolveProductionDurationMin(order: SixHiOrderDetail): number | null {
  if (order.prodDurationMin != null && order.prodDurationMin > 0) {
    return order.prodDurationMin;
  }
  const netMs = netProductionRuntimeMs(order);
  if (netMs == null) return order.prodDurationMin ?? null;
  if (netMs <= 0) return order.prodDurationMin ?? null;
  return Math.max(1, Math.round(netMs / 60_000));
}

/** Total stoppage minutes derived from stoppage records. */
export function resolveTotalStoppageMin(order: SixHiOrderDetail): number {
  return Math.round(totalStoppageMs(order, false) / 60_000);
}

/** Wall-clock production span in minutes (includes stoppage time). */
export function resolveWallDurationMin(order: SixHiOrderDetail): number | null {
  const wall = wallProductionMs(order);
  if (wall == null || wall <= 0) return null;
  return Math.max(1, Math.round(wall / 60_000));
}

export function formatRuntimeMs(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Human-readable duration label for history panels (minutes). */
export function formatProductionDurationMin(min?: number | null): string {
  if (min == null || min <= 0) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function canRecordStoppage(order: SixHiOrderDetail | null | undefined): boolean {
  if (!order) return false;
  if (order.activeStoppage) return true;
  return order.status === 'IN_PROGRESS' || order.status === 'STOPPAGE';
}
