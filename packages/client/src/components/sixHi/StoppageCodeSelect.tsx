import type { SixHiStoppageCodeDef } from './SixHiStoppageCodes';

interface StoppageCodeSelectProps {
  value: string;
  onChange: (displayCode: string) => void;
  codes: SixHiStoppageCodeDef[];
  loading?: boolean;
  disabled?: boolean;
}

/** Native select — custom menu was clipped inside stoppage modal overflow. */
export function StoppageCodeSelect({ value, onChange, codes, loading, disabled }: StoppageCodeSelectProps) {
  const known = codes.some((c) => c.displayCode === value);
  return (
    <select
      value={value}
      disabled={disabled || loading}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Stoppage code"
      className={[
        'w-full min-h-14 rounded-xl border border-border bg-white px-3 text-base font-semibold',
        'text-foreground disabled:opacity-50',
      ].join(' ')}
    >
      {loading && <option value={value || ''}>Loading stoppage codes…</option>}
      {!loading && codes.length === 0 && <option value={value || ''}>{value || 'No stoppage codes'}</option>}
      {!loading && !known && value ? (
        <option value={value}>{value}</option>
      ) : null}
      {codes.map((c) => (
        <option key={c.displayCode} value={c.displayCode}>
          {c.displayCode} — {c.label}
        </option>
      ))}
    </select>
  );
}
