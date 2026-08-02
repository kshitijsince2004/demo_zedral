import type { ReactNode } from 'react';

export type TolBand = 'ok' | 'warn' | 'na';

/** Δ + tolerance cue beside plan/actual. Green in-band, amber out. */
export function deltaBand(actual: number | undefined | null, planned: number | undefined | null, tolAbs: number): {
  delta: number | null;
  band: TolBand;
  label: string;
} {
  if (actual == null || planned == null || !Number.isFinite(actual) || !Number.isFinite(planned)) {
    return { delta: null, band: 'na', label: '—' };
  }
  const delta = actual - planned;
  const band: TolBand = Math.abs(delta) <= tolAbs ? 'ok' : 'warn';
  const sign = delta > 0 ? '+' : '';
  return { delta, band, label: `${sign}${delta.toFixed(3)}` };
}

export function ProcessPairedField({
  planLabel,
  planValue,
  actualControl,
  deltaLabel,
  band,
}: {
  planLabel: string;
  planValue: string | number;
  actualControl: ReactNode;
  deltaLabel?: string;
  band?: TolBand;
}) {
  const cue =
    band === 'ok'
      ? 'text-success bg-success/10 border-success/30'
      : band === 'warn'
        ? 'text-amber-800 bg-amber-50 border-amber-200'
        : 'text-muted-foreground bg-muted/40 border-border/50';

  return (
    <div className="grid grid-cols-2 gap-2 col-span-2 sm:col-span-2">
      <div className="bg-secondary/40 rounded-lg px-3 py-2">
        <p className="text-[10px] uppercase text-muted-foreground">{planLabel}</p>
        <p className="font-mono font-semibold">{planValue}</p>
      </div>
      <div className="relative">
        {actualControl}
        {deltaLabel != null && deltaLabel !== '—' && (
          <span className={`absolute -top-1 right-1 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${cue}`}>
            Δ {deltaLabel}
          </span>
        )}
      </div>
    </div>
  );
}
