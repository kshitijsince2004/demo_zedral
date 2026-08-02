export function fmtDur(v: number | string | null | undefined): string {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n < 10 ? n.toFixed(1) : n.toFixed(0);
}

export function fmtMt(v: number | string | null | undefined): string {
  if (v == null || v === '') return '—';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : '—';
}
