// PERF-B1/B3 — memo row + select control extracted from AnnMhReportPage
import { memo, useMemo, useState } from 'react';
import type { Tone } from '../../../lib/tones';
import { toneRail } from '../../../lib/tones';
import { ZInput } from '../../../components/primitives/ZInput';

export type AnnReportTableRow = {
  rowId: string;
  taken_at: string;
  parameter: string;
  current: number | string | null;
  min: number | null;
  max: number | null;
  avg: number | null;
  status: string;
  statusTone: Tone;
  remarks: string;
};

export const AnnReportDetailRow = memo(function AnnReportDetailRow({ r }: { r: AnnReportTableRow }) {
  return (
    <tr
      className={[
        'border-t border-border font-mono tabular-nums text-foreground',
        'odd:bg-muted/10 even:bg-background hover:bg-muted/30 transition-colors',
      ].join(' ')}
    >
      <td className="p-2 whitespace-nowrap">{new Date(r.taken_at).toLocaleString('en-IN')}</td>
      <td className="p-2">{r.parameter}</td>
      <td className="p-2">{r.current != null ? (typeof r.current === 'number' ? r.current.toFixed(2) : String(r.current)) : '—'}</td>
      <td className="p-2">{r.min != null ? r.min.toFixed(2) : '—'}</td>
      <td className="p-2">{r.max != null ? r.max.toFixed(2) : '—'}</td>
      <td className="p-2">{r.avg != null ? r.avg.toFixed(2) : '—'}</td>
      <td className="p-2">
        <span className={`inline-flex items-center gap-2 ${toneRail[r.statusTone]} px-2 py-1 rounded-md`} style={{ background: 'transparent' }}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
          {r.status}
        </span>
      </td>
      <td className="p-2 text-muted-foreground">{r.remarks}</td>
    </tr>
  );
});

export function SearchableValueSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return options;
    return options.filter((o) => o.toLowerCase().includes(qq));
  }, [options, q]);

  const selected = value ? options.find((o) => o === value) : undefined;

  return (
    <div className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
      <span>{label}</span>
      <div className="relative">
        <ZInput
          className="!h-10 rounded-lg"
          value={open ? q : (selected ?? '')}
          placeholder={placeholder}
          mono={false}
          disabled={disabled}
          onChange={(e) => {
            setQ(e.target.value);
            if (!open) setOpen(true);
          }}
          onPointerDown={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          aria-label={label}
        />
        {open && !disabled && (
          <div
            className="absolute z-20 mt-2 w-full rounded-lg border border-border bg-background shadow-lg max-h-60 overflow-auto"
            role="listbox"
            aria-label={`${label} options`}
          >
            {filtered.length === 0 ? (
              <div className="p-3 text-xs text-muted-foreground">No matches</div>
            ) : (
              filtered.map((opt) => {
                const isActive = opt === value;
                return (
                  <button
                    key={opt}
                    type="button"
                    className={[
                      'w-full text-left px-3 py-2 text-sm',
                      isActive ? 'bg-muted/30' : 'hover:bg-muted/30',
                    ].join(' ')}
                    onClick={() => {
                      onChange(opt);
                      setOpen(false);
                      setQ('');
                    }}
                  >
                    <span className="font-mono tabular-nums">{opt}</span>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
      {open && (
        <button
          type="button"
          className="sr-only"
          onBlur={() => {
            setOpen(false);
            setQ('');
          }}
        />
      )}
    </div>
  );
}
