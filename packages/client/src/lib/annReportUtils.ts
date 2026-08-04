import type { Tone } from './tones';

export type Stage = { stage_code: string; seq: number; start_at: string | null; end_at: string | null; skipped: boolean };

export type Reading = {
  reading_id: string;
  taken_at: string;
  stage_code: string | null;
  charge_temp: number | string | null;
  gas_temp: number | string | null;
  fc_temp: number | string | null;
  base_press: number | string | null;
  base_fan_rpm: number | string | null;
  n2h2_flow: number | string | null;
  fuel_flow: number | string | null;
  rcf_rpm: number | string | null;
};

export type Stoppage = { stoppage_id: string | number; category_code: string; start_at: string; end_at: string | null; reason: string | null; remark: string | null };

export type MetricKey = 'charge_temp' | 'gas_temp' | 'fc_temp' | 'base_press' | 'base_fan_rpm' | 'n2h2_flow' | 'fuel_flow' | 'rcf_rpm';

export type MetricMeta = { key: MetricKey; label: string };

export const METRICS: MetricMeta[] = [
  { key: 'charge_temp', label: 'Charge temp' },
  { key: 'gas_temp', label: 'Gas temp' },
  { key: 'fc_temp', label: 'Base temp' },
  { key: 'base_press', label: 'Pressure' },
  { key: 'base_fan_rpm', label: 'Fan RPM' },
  { key: 'n2h2_flow', label: 'N2/H2 flow' },
  { key: 'fuel_flow', label: 'Fuel flow' },
  { key: 'rcf_rpm', label: 'RCF RPM' },
];

export function num(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function fmt(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });
}

export function toChartLabel(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function toDateTimeLocalValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function computeStats(values: Array<number | null>) {
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (finite.length === 0) return { min: null as number | null, max: null as number | null, avg: null as number | null, current: null as number | null };
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const avg = finite.reduce((s, v) => s + v, 0) / finite.length;
  const current = finite[finite.length - 1] ?? null;
  return { min, max, avg, current };
}

export function statusFromSpec(value: number | null, limit?: { min: number | null; max: number | null }): { status: string; tone: Tone; remarks: string } {
  if (value == null) return { status: '—', tone: 'muted', remarks: 'No reading' };
  if (!limit) return { status: '—', tone: 'muted', remarks: 'No spec limits configured' };
  const { min, max } = limit;
  if (min != null && value < min) return { status: 'LOW', tone: 'warning', remarks: `Expected >= ${min}` };
  if (max != null && value > max) return { status: 'HIGH', tone: 'warning', remarks: `Expected <= ${max}` };
  return { status: 'OK', tone: 'success', remarks: 'Within spec' };
}

export function isHeatingStageCode(stageCode: string) {
  const u = stageCode.toUpperCase();
  return u.includes('HEAT') || u.includes('WI');
}

export function isCoolingStageCode(stageCode: string) {
  const u = stageCode.toUpperCase();
  return u.includes('COOL');
}

export function buildStageWindows(stagesSorted: Stage[], predicate: (stageCode: string) => boolean) {
  return stagesSorted
    .filter((s) => s.start_at && predicate(s.stage_code))
    .map((s) => {
      const startMs = new Date(String(s.start_at)).getTime();
      const endMs = s.end_at ? new Date(String(s.end_at)).getTime() : Date.now();
      return { stage: s, startMs, endMs };
    });
}

export function readingsInWindows(readingsAsc: Reading[], windows: Array<{ startMs: number; endMs: number }>) {
  if (windows.length === 0) return [];
  return readingsAsc.filter((r) => {
    const ms = new Date(r.taken_at).getTime();
    return windows.some((w) => ms >= w.startMs && ms <= w.endMs);
  });
}

