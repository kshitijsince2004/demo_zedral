import type { ShiftReadingsValues } from './shiftReadingsValues';

/** Compact coolant/scrap form for in-shift entry and MH backfill. */
export function ShiftReadingsFields({
  values,
  onChange,
  disabled,
}: {
  values: ShiftReadingsValues;
  onChange: (next: ShiftReadingsValues) => void;
  disabled?: boolean;
}) {
  const field = (key: keyof ShiftReadingsValues, label: string, placeholder: string) => (
    <label className="block text-xs space-y-1">
      <span className="font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
      <input
        type="number"
        step="any"
        disabled={disabled}
        value={values[key]}
        onChange={(e) => onChange({ ...values, [key]: e.target.value })}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
      />
    </label>
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {field('coolantTempDegC', 'Coolant Temp C', 'e.g. 42')}
      {field('coolantPressKgCm2', 'Coolant Press Kg/cm2', 'e.g. 1.2')}
      {field('scrapKg', 'Scrap Kg', 'e.g. 15')}
    </div>
  );
}