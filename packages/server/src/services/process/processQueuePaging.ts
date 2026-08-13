import type { AutoSourceService } from '../AutoSourceService';

export interface ProcessQueueCard {
  coilNo: string;
  displayCoilNo?: string;
  gradeCode: string;
  customerName: string;
  widthMm?: number;
  thicknessMm?: number;
  weightMt?: number;
  status: 'PENDING' | 'PREPARING' | 'IN_PROGRESS' | 'STOPPAGE' | 'HOLD' | 'REJECTED' | 'COMPLETED';
  journeyId: string;
  stepNo: number;
  batchNumber?: string;
  /** ANN plan Annealing Batch (raw_row_json) — MH create default when body omits. */
  annealingBatch?: string;
  /** Process route string from PPC / transfer. */
  routeRaw?: string;
  /** PKL sibling key */
  motherCoilNo?: string;
  slitId?: string;
  /** Pass: number of order-lines on this mother coil */
  lineCount?: number;
  /** HRS combination display e.g. 483+483+536 */
  combination?: string;
  /** Pass order-lines from ppc_batch */
  orderLines?: Array<{
    batchNumber?: string;
    widthMm?: number;
    weightMt?: number;
    thicknessMm?: number;
    finishThicknessMm?: number;
    customerName?: string;
    routeRaw?: string;
    slitId?: string;
    surfaceFinish?: string;
    toWorkCenter?: string;
    suggestedMachine?: string;
  }>;
  prefill?: Awaited<ReturnType<typeof AutoSourceService.resolvePrefill>>;
}

/** PERF-C2: in-memory page when limit set; full list otherwise (exports / legacy). */
// ponytail: journey queue is small enough that DB cursor isn't worth a second code path yet
export function pageProcessQueue(
  cards: ProcessQueueCard[],
  paging?: { limit?: number; cursor?: string },
): { queue: ProcessQueueCard[]; nextCursor?: string | null } {
  const limit = paging?.limit != null && paging.limit > 0
    ? Math.min(200, Math.max(1, Math.floor(paging.limit)))
    : undefined;
  if (!limit) return { queue: cards };
  let start = 0;
  if (paging?.cursor) {
    const idx = cards.findIndex((c) => c.journeyId === paging.cursor || c.coilNo === paging.cursor);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const page = cards.slice(start, start + limit);
  const nextCursor = start + limit < cards.length && page.length > 0
    ? (page[page.length - 1].journeyId || page[page.length - 1].coilNo)
    : null;
  return { queue: page, nextCursor };
}

/** Plan Annealing Batch from ppc_batch.raw_row_json (ANN import extras). */
export function planAnnealingBatchFromRaw(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === 'object' && !Array.isArray(raw)) obj = raw as Record<string, unknown>;
  else if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) obj = parsed as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  if (!obj) return undefined;
  const v = obj.annealingBatch ?? obj.annealing_batch;
  const s = v != null ? String(v).trim() : '';
  return s || undefined;
}

export function toOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function mapStepStatus(status: string, journeyStatus: string): ProcessQueueCard['status'] {
  if (journeyStatus === 'HOLD') return 'HOLD';
  if (status === 'COMPLETED') return 'COMPLETED';
  if (status === 'ACTIVE') return 'IN_PROGRESS';
  return 'PENDING';
}
