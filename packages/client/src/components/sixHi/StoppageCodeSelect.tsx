import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { SixHiStoppageCodeDef } from './SixHiStoppageCodes';

interface StoppageCodeSelectProps {
  value: string;
  onChange: (displayCode: string) => void;
  codes: SixHiStoppageCodeDef[];
  loading?: boolean;
  disabled?: boolean;
}

export function StoppageCodeSelect({ value, onChange, codes, loading, disabled }: StoppageCodeSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = codes.find((c) => c.displayCode === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={[
          'w-full min-h-14 rounded-xl border border-border bg-white px-3 text-base font-semibold',
          'text-foreground flex items-center justify-between gap-2',
          'disabled:opacity-50',
        ].join(' ')}
      >
        <span className="truncate text-left">
          {loading
            ? 'Loading stoppage codes…'
            : selected
              ? `${selected.displayCode} — ${selected.label}`
              : 'Select stoppage code'}
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && !loading && (
        <ul
          role="listbox"
          aria-label="Stoppage code"
          className="absolute z-30 left-0 right-0 mt-1 max-h-52 overflow-y-auto rounded-xl border border-border bg-white shadow-lg"
        >
          {codes.map((c) => {
            const isSelected = c.displayCode === value;
            return (
              <li key={c.displayCode} role="option" aria-selected={isSelected}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(c.displayCode);
                    setOpen(false);
                  }}
                  className={[
                    'w-full min-h-12 px-3 py-2 text-left text-sm font-semibold',
                    isSelected
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-white text-foreground hover:bg-secondary',
                  ].join(' ')}
                >
                  <span className="font-mono">{c.displayCode}</span>
                  <span className="mx-2 opacity-70">—</span>
                  <span>{c.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
