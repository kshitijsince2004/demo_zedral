import type { MasterDefectCode } from '@m1/shared-validation';

/** Client-side "Other" defect tag — stored as custom code with remarks. Not a DB row. */
export const DEFECT_OTHER_CODE = 'OTHER';

export function defectCodeSortKey(code: string): number {
  const trimmed = code.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);
  const match = trimmed.match(/\d+/);
  return match ? Number.parseInt(match[0], 10) : Number.MAX_SAFE_INTEGER;
}

export function normalizeDefectCodes(raw: unknown): MasterDefectCode[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const defectCode = String(row.defectCode ?? row.defect_code ?? '').trim();
      const defectName = String(row.defectName ?? row.description ?? '').trim();
      if (!defectCode || !defectName) return null;
      return {
        defectCode,
        defectName,
        category: (row.category ?? row.applies_to ?? null) as string | null,
        isActive: row.isActive !== false && row.is_active !== false,
      };
    })
    .filter((item): item is MasterDefectCode => item != null && item.isActive);
}

export function sortDefectCodes(defects: MasterDefectCode[]): MasterDefectCode[] {
  return [...defects].sort((a, b) => {
    const keyA = defectCodeSortKey(a.defectCode);
    const keyB = defectCodeSortKey(b.defectCode);
    if (keyA !== keyB) return keyA - keyB;
    return a.defectCode.localeCompare(b.defectCode, undefined, { numeric: true });
  });
}

export function withOtherDefectOption(defects: MasterDefectCode[]): MasterDefectCode[] {
  const sorted = sortDefectCodes(defects);
  if (sorted.some((d) => d.defectCode === DEFECT_OTHER_CODE)) return sorted;
  return [
    ...sorted,
    {
      defectCode: DEFECT_OTHER_CODE,
      defectName: 'Other',
      category: null,
      isActive: true,
    },
  ];
}

/** Defect list from API only — configured in Admin → Master Data → Defect Codes. */
export function resolveDefectCodes(raw: unknown): MasterDefectCode[] {
  return withOtherDefectOption(normalizeDefectCodes(raw));
}
