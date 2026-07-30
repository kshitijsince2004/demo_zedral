import { SpecResolverService, type ResolvedParameter, type ResolveKey } from './SpecResolverService';
import { ProcessSheetService } from './ProcessSheetService';

export interface SpecFetchQuery {
  by: 'order' | 'grade+customer' | 'sheet' | 'coil';
  orderId?: string | number;
  coilNo?: string;
  gradeCode?: string;
  customerId?: number | null;
  materialCode?: string | null;
  surfaceFinish?: string | null;
  widthMm?: number | null;
  finishThkMm?: number | null;
  lengthMm?: number | null;
  parameters?: string[];
  groups?: string[];
  process?: string;
  mandatoryOnly?: boolean;
  mode?: 'resolved' | 'snapshot' | 'draft';
  asOf?: Date;
  projection?: string[];
}

export type ParameterView = ResolvedParameter & {
  versionId: number;
  source: 'customer' | 'default';
};

function project(row: ParameterView, projection?: string[]): Record<string, unknown> {
  if (!projection?.length) return row as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of projection) {
    if (key in row) out[key] = (row as unknown as Record<string, unknown>)[key];
  }
  return out;
}

export class SpecFetchService {
  static async fetch(q: SpecFetchQuery): Promise<Record<string, unknown>[]> {
    let resolved = null as Awaited<ReturnType<typeof SpecResolverService.resolve>>;
    const mode = q.mode ?? 'resolved';

    if (q.by === 'coil' && q.coilNo) {
      resolved = await SpecResolverService.resolveForCoil(String(q.coilNo));
    } else if (q.by === 'order' || mode === 'snapshot') {
      if (q.orderId == null) return [];
      resolved = await SpecResolverService.resolveForOrder(q.orderId);
    } else {
      const key: ResolveKey = {
        gradeCode: q.gradeCode ?? '',
        customerId: q.customerId ?? null,
        materialCode: q.materialCode,
        surfaceFinish: q.surfaceFinish,
        widthMm: q.widthMm,
        finishThkMm: q.finishThkMm,
        lengthMm: q.lengthMm,
        atTime: q.asOf,
      };
      resolved = await SpecResolverService.resolve(key);
    }

    if (!resolved) return [];

    let rows: ParameterView[] = resolved.parameters.map((p) => ({
      ...p,
      versionId: resolved!.versionId,
      source: resolved!.source,
    }));

    // Phase 5: process-sheet step checks override applies_to when present
    if (q.process && q.gradeCode) {
      const sheetCodes = await ProcessSheetService.checksForProcess(
        q.gradeCode,
        q.process,
        q.customerId,
      );
      if (sheetCodes?.length) {
        const set = new Set(sheetCodes.map((c) => c.toUpperCase()));
        rows = rows.filter((r) => set.has(r.code.toUpperCase()));
      } else {
        const proc = q.process.toUpperCase();
        rows = rows.filter(
          (r) => r.appliesTo.includes('ALL') || r.appliesTo.map((a) => a.toUpperCase()).includes(proc),
        );
      }
    } else if (q.process) {
      const proc = q.process.toUpperCase();
      rows = rows.filter(
        (r) => r.appliesTo.includes('ALL') || r.appliesTo.map((a) => a.toUpperCase()).includes(proc),
      );
    }

    if (q.parameters?.length) {
      const set = new Set(q.parameters.map((c) => c.toUpperCase()));
      rows = rows.filter((r) => set.has(r.code.toUpperCase()));
    }
    if (q.groups?.length) {
      const set = new Set(q.groups.map((g) => g.toUpperCase()));
      rows = rows.filter((r) => r.group && set.has(r.group.toUpperCase()));
    }
    if (q.mandatoryOnly) rows = rows.filter((r) => r.mandatory);

    return rows.map((r) => project(r, q.projection));
  }

  static async fetchBatch(
    items: SpecFetchQuery[],
  ): Promise<Array<{ key: SpecFetchQuery; rows: Record<string, unknown>[] }>> {
    const out: Array<{ key: SpecFetchQuery; rows: Record<string, unknown>[] }> = [];
    for (const item of items.slice(0, 100)) {
      out.push({ key: item, rows: await this.fetch(item) });
    }
    return out;
  }
}
