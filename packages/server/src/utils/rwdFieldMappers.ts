/** Map plan Surface (BRIGHT/MATT) -> operator codes B/M. Blank -> null (RWD-Q2). */
export function mapPlanSurfaceToCode(raw: string | null | undefined): 'M' | 'B' | null {
  if (raw == null || String(raw).trim() === '') return null;
  const v = String(raw).trim().toUpperCase();
  if (v === 'B' || v.includes('BRIGHT')) return 'B';
  if (v === 'M' || v.includes('MATT') || v.includes('MATTE')) return 'M';
  return null;
}

/** Split coil-slit display ids; last short segment treated as slit when present. */
export function parseCoilIdentity(coilNo: string): { coilNo: string; slitId: string | null } {
  const m = String(coilNo).trim().match(/^(.+)-([A-Za-z0-9]{1,4})$/);
  if (m) return { coilNo: m[1], slitId: m[2] };
  return { coilNo: String(coilNo).trim(), slitId: null };
}

/** coil_no + slit_id with guard against double-suffix. */
export function formatDisplayCoilNo(coilNo: string, slitId?: string | null): string {
  const base = String(coilNo).trim();
  if (!slitId) return base;
  const suffix = '-' + slitId;
  if (base.toUpperCase().endsWith(suffix.toUpperCase())) return base;
  return base + suffix;
}