import { combinedRunKey } from './sixHiOrderIdentity';

export const MANUAL_REROLL_TAB = { id: 'reroll', label: 'Manual Re-Roll' } as const;

export type ManualRerollStatusFilter = 'ALL' | 'PENDING' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED';

export const MANUAL_REROLL_STATUS_FILTERS: { id: ManualRerollStatusFilter; label: string }[] = [
  { id: 'ALL', label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'IN_PROGRESS', label: 'In Progress' },
  { id: 'ON_HOLD', label: 'Hold' },
  { id: 'COMPLETED', label: 'Completed' },
];

export function manualRerollUiFlags(input: {
  flagOn: boolean;
  role: string | null | undefined;
  hasMachineAccess: boolean;
}): { showEntry: boolean; canWrite: boolean } {
  const showEntry = input.flagOn && input.hasMachineAccess;
  const role = String(input.role ?? '').toUpperCase();
  const canWrite = showEntry && (role === 'OPERATOR' || role === 'ADMIN');
  return { showEntry, canWrite };
}

export function withManualRerollTab<T extends { id: string; label: string }>(
  tabs: T[],
  enabled: boolean,
): Array<T | typeof MANUAL_REROLL_TAB> {
  return enabled ? [...tabs, MANUAL_REROLL_TAB] : tabs;
}

/** Prefer pill tab over enter button once entry is allowed. */
export function showManualRerollEnterButton(_showEntry: boolean, _machine?: string, _activeTab?: string): boolean {
  return false;
}

export function rerollCombineKey(hit: {
  batchNumber: string;
  coilNo?: string | null;
  slitId?: string | null;
  rollFinish?: string | null;
  subProcess?: string | null;
}): string {
  const identity = combinedRunKey({
    batchNumber: hit.batchNumber,
    motherCoil: hit.coilNo || hit.batchNumber,
    slitId: hit.slitId ?? undefined,
    rollFinish: hit.rollFinish ?? undefined,
  });
  // Same bucket as SixHi combine: identity + subprocess
  return `${hit.subProcess?.trim() || ''}|${identity}`;
}

/** Pending queue row (includes PREPARING like SixHi combine bucket). */
export function isRerollPendingStatus(status: string): boolean {
  return status === 'PENDING' || status === 'PREPARING';
}

export function parseRerollQuantity(raw: string): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatRerollSummaryCard(summary: { totalRerollMt: number; sessionCount: number } | null | undefined) {
  if (!summary) return { total: '—', detail: 'No summary yet' };
  return {
    total: `${summary.totalRerollMt.toFixed(3)} MT`,
    detail: `${summary.sessionCount} completed session${summary.sessionCount === 1 ? '' : 's'} today`,
  };
}

export function formatManualRerollConflict(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;
  const rec = body as { error?: unknown; activeBatchNumber?: unknown };
  const error = typeof rec.error === 'string' ? rec.error : fallback;
  const batch = typeof rec.activeBatchNumber === 'string' ? rec.activeBatchNumber : '';
  return batch ? `${error} (${batch})` : error;
}

/** STOPPAGE buckets under In Progress, matching rolling queue behaviour. */
export function matchesRerollStatusFilter(
  status: string,
  filter: ManualRerollStatusFilter,
): boolean {
  if (filter === 'ALL') return status !== 'CANCELLED';
  if (filter === 'IN_PROGRESS') return status === 'IN_PROGRESS' || status === 'STOPPAGE';
  if (filter === 'PENDING') return isRerollPendingStatus(status);
  if (filter === 'ON_HOLD') return status === 'ON_HOLD';
  if (filter === 'COMPLETED') return status === 'COMPLETED';
  return false;
}

export function countRerollFilters(items: Array<{ status: string }>): Record<ManualRerollStatusFilter, number> {
  const counts: Record<ManualRerollStatusFilter, number> = {
    ALL: 0,
    PENDING: 0,
    IN_PROGRESS: 0,
    ON_HOLD: 0,
    COMPLETED: 0,
  };
  for (const item of items) {
    if (item.status === 'CANCELLED') continue;
    counts.ALL += 1;
    if (isRerollPendingStatus(item.status)) counts.PENDING += 1;
    else if (item.status === 'IN_PROGRESS' || item.status === 'STOPPAGE') counts.IN_PROGRESS += 1;
    else if (item.status === 'ON_HOLD') counts.ON_HOLD += 1;
    else if (item.status === 'COMPLETED') counts.COMPLETED += 1;
  }
  return counts;
}

/** Net runtime ms = wall − closed/open stoppages (open counted to now). */
export function rerollNetRuntimeMs(
  startTime: string,
  stoppages: Array<{ startTime: string; endTime?: string | null }> | undefined,
  nowMs: number,
): number {
  const start = new Date(startTime).getTime();
  if (!Number.isFinite(start)) return 0;
  let stopMs = 0;
  for (const s of stoppages ?? []) {
    const from = new Date(s.startTime).getTime();
    if (!Number.isFinite(from)) continue;
    const to = s.endTime ? new Date(s.endTime).getTime() : nowMs;
    if (!Number.isFinite(to)) continue;
    stopMs += Math.max(0, to - from);
  }
  return Math.max(0, nowMs - start - stopMs);
}

export function formatRerollNetRuntime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}
