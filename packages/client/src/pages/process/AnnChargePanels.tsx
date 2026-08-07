// PERF-B3 - presentational widgets extracted from AnnChargePage
import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronsRight,
  Cloud,
  Droplets,
  Fan,
  Flame,
  Hourglass,
  RefreshCw,
  ThermometerSnowflake,
  Wind,
  Zap,
} from 'lucide-react';
export type Stage = {
  stage_id: string;
  stage_code: string;
  seq: number;
  start_at: string | null;
  end_at: string | null;
  duration_min: number | string | null;
  skipped: boolean;
};

export type Reading = {
  reading_id: string;
  taken_at: string;
  stage_code: string | null;
  charge_temp: number | string | null;
  gas_temp: number | string | null;
  fc_temp: number | string | null;
  n2h2_flow: number | string | null;
  base_press: number | string | null;
  base_fan_rpm: number | string | null;
  fuel_flow: number | string | null;
  rcf_rpm: number | string | null;
};

export type RosterRow = {
  coil_no: string;
  seq_no: number | null;
  disposition: string;
  grade_code: string | null;
  weight_mt: number | string | null;
};

export type Stoppage = {
  stoppage_id: string | number;
  category_code: string;
  start_at: string;
  end_at: string | null;
  duration_min: number | string | null;
  reason: string | null;
  remark: string | null;
};

export type ReadingKey =
  | 'chargeTemp'
  | 'gasTemp'
  | 'fcTemp'
  | 'basePress'
  | 'baseFanRpm'
  | 'fuelFlow'
  | 'rcfRpm'
  | 'n2h2Flow';

export const EMPTY_READING: Record<ReadingKey, string> = {
  chargeTemp: '',
  gasTemp: '',
  fcTemp: '',
  n2h2Flow: '',
  basePress: '',
  baseFanRpm: '',
  fuelFlow: '',
  rcfRpm: '',
};

/** Field order for rapid Enter-to-next entry (UI only) — 3×3 grid with Remarks. */
export const READING_FIELDS: { key: ReadingKey; label: string; unit: string }[] = [
  { key: 'chargeTemp', label: 'Charge Temp', unit: '°C' },
  { key: 'gasTemp', label: 'Gas Temp', unit: '°C' },
  { key: 'fcTemp', label: 'F/C Temp', unit: '°C' },
  { key: 'n2h2Flow', label: 'N₂/H₂ Flow', unit: '' },
  { key: 'basePress', label: 'Base Pressure', unit: '' },
  { key: 'baseFanRpm', label: 'Base Fan', unit: 'RPM' },
  { key: 'fuelFlow', label: 'Fuel Flow', unit: '' },
  { key: 'rcfRpm', label: 'RCF', unit: 'RPM' },
];

/** One distinct icon per WI stage (always shown on the timeline). */
export const STAGE_ICON: Record<string, ReactNode> = {
  LOADING: <ArrowDownToLine className="h-5 w-5" strokeWidth={1.75} aria-hidden />,
  PURGING: <Wind className="h-5 w-5" strokeWidth={1.75} aria-hidden />,
  HEATING: <Flame className="h-5 w-5" strokeWidth={1.75} aria-hidden />,
  SOAKING: <Hourglass className="h-5 w-5" strokeWidth={1.75} aria-hidden />,
  FURNACE_COOL: <Fan className="h-5 w-5" strokeWidth={1.75} aria-hidden />,
  NATURAL_COOL: <Cloud className="h-5 w-5" strokeWidth={1.75} aria-hidden />,
  RAPID_COOL: <Zap className="h-5 w-5" strokeWidth={1.75} aria-hidden />,
  WATER_COOL: <Droplets className="h-5 w-5" strokeWidth={1.75} aria-hidden />,
  POST_PURGING: <RefreshCw className="h-5 w-5" strokeWidth={1.75} aria-hidden />,
  UNLOADING: <ArrowUpFromLine className="h-5 w-5" strokeWidth={1.75} aria-hidden />,
};

export const STAGE_LABEL: Record<string, string> = {
  LOADING: 'Loading',
  PURGING: 'Purging',
  HEATING: 'Heating',
  SOAKING: 'Soaking',
  FURNACE_COOL: 'Furnace Cool',
  NATURAL_COOL: 'Natural Cool',
  RAPID_COOL: 'Rapid Cool',
  WATER_COOL: 'Water Cool',
  POST_PURGING: 'Post Purging',
  UNLOADING: 'Unloading',
};

export function humanizeStage(code: string) {
  return STAGE_LABEL[code] ?? code.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatReadingTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function formatDurationMin(raw: number | string | null | undefined): string {
  if (raw == null || raw === '') return '—';
  const min = Math.max(0, Math.floor(Number(raw)));
  if (!Number.isFinite(min)) return '—';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

export function formatElapsed(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '—';
  return formatDurationMin(Math.floor((nowMs - new Date(iso).getTime()) / 60_000));
}

export function MetaInline({ label, value, onPrimary }: { label: string; value: string; onPrimary?: boolean }) {
  return (
    <span className="inline-flex min-w-0 flex-col gap-1">
      <span
        className={[
          'shrink-0 text-[9px] font-bold uppercase leading-none tracking-[0.12em]',
          onPrimary ? 'text-primary-foreground/70' : 'text-muted-foreground',
        ].join(' ')}
      >
        {label}
      </span>
      <span
        className={[
          'truncate font-mono text-sm font-bold tabular-nums leading-tight',
          onPrimary ? 'text-primary-foreground' : 'text-foreground',
        ].join(' ')}
      >
        {value}
      </span>
    </span>
  );
}

/** Icon stage timeline — fills card width on tablet/desktop; scrolls on narrow. */
export function ChargeDetailsTimeline({ stages, activeCode, nowMs }: { stages: Stage[]; activeCode: string | null; nowMs: number }) {
  const sorted = useMemo(() => [...stages].sort((a, b) => a.seq - b.seq), [stages]);
  const [selected, setSelected] = useState<Stage | null>(null);

  const durationMin =
    selected?.start_at && selected?.end_at
      ? Math.max(0, Math.round((new Date(selected.end_at).getTime() - new Date(selected.start_at).getTime()) / 60_000))
      : selected?.start_at && !selected.end_at && !selected.skipped
        ? Math.max(0, Math.round((nowMs - new Date(selected.start_at).getTime()) / 60_000))
        : null;

  return (
    <div className="w-full space-y-2">
      <div className="w-full overflow-x-auto overscroll-x-contain px-0.5 py-2">
        <ol className="relative flex w-full min-w-[42rem] items-stretch">
          {sorted.map((s, idx) => {
            const done = Boolean(s.end_at) || s.skipped;
            const current = s.stage_code === activeCode && !done;
            const icon = STAGE_ICON[s.stage_code] ?? <ThermometerSnowflake className="h-5 w-5" strokeWidth={1.75} aria-hidden />;
            const elapsed = current && s.start_at ? formatElapsed(s.start_at, nowMs) : null;
            return (
              <li key={s.stage_code} className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5 px-0.5">
                {idx < sorted.length - 1 && (
                  <span
                    className={[
                      'absolute left-[calc(50%+1.4rem)] right-[calc(-50%+1.4rem)] top-[1.4rem] h-[3px] rounded-full sm:top-[1.55rem]',
                      done || current ? 'bg-status-running' : 'bg-border',
                    ].join(' ')}
                    aria-hidden
                  />
                )}
                <button
                  type="button"
                  className={[
                    'relative z-[1] mx-auto flex h-11 w-11 min-h-11 min-w-11 items-center justify-center rounded-full border-2 bg-background touch-manipulation',
                    'sm:h-[3.25rem] sm:w-[3.25rem] sm:min-h-[3.25rem] sm:min-w-[3.25rem] md:h-14 md:w-14 md:min-h-14 md:min-w-14',
                    'transition-[box-shadow,transform,background-color] duration-150 active:scale-95',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    done ? 'border-status-running text-status-running bg-status-running/5' : '',
                    current
                      ? 'border-status-running bg-status-running/15 text-status-running ring-4 ring-status-running/30'
                      : '',
                    !done && !current ? 'border-border text-muted-foreground opacity-70' : '',
                    selected?.stage_code === s.stage_code ? 'ring-2 ring-ring' : '',
                  ].join(' ')}
                  title={humanizeStage(s.stage_code)}
                  onClick={() => setSelected(s)}
                >
                  {icon}
                  {done && (
                    <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-status-running text-primary-foreground shadow-sm">
                      <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                    </span>
                  )}
                </button>
                <span
                  className={[
                    'w-full max-w-[5.5rem] px-0.5 text-center text-[9px] leading-tight font-medium sm:text-[10px]',
                    current ? 'font-bold text-status-running' : done ? 'text-foreground' : 'text-muted-foreground',
                  ].join(' ')}
                >
                  {humanizeStage(s.stage_code)}
                  {current ? ' · NOW' : ''}
                </span>
                <div className="flex h-5 items-center justify-center">
                  {elapsed ? (
                    <span className="rounded-full bg-status-running/15 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-status-running">
                      {elapsed}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
      {selected && (
        <p className="truncate rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
          {humanizeStage(selected.stage_code)}
          {' · '}{selected.start_at ? formatReadingTime(selected.start_at) : '—'}
          {' → '}{selected.end_at ? formatReadingTime(selected.end_at) : '—'}
          {durationMin != null ? ` · ${durationMin}m` : ''}
          {selected.skipped ? ' · SKIP' : ''}
        </p>
      )}
    </div>
  );
}

export function SwipeAdvance({
  disabled,
  nextLabel,
  onAdvance,
}: {
  disabled: boolean;
  nextLabel: string;
  onAdvance: () => Promise<void>;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const maxX = useRef(200);

  function onPointerDown(e: ReactPointerEvent) {
    if (disabled) return;
    const track = trackRef.current;
    if (!track) return;
    maxX.current = Math.max(160, track.clientWidth - 56);
    startX.current = e.clientX;
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  async function onPointerUp() {
    if (!dragging) return;
    setDragging(false);
    const threshold = maxX.current * 0.72;
    if (dragX >= threshold) {
      setDragX(maxX.current);
      try {
        await onAdvance();
      } finally {
        setDragX(0);
      }
    } else {
      setDragX(0);
    }
  }

  function onPointerMove(e: ReactPointerEvent) {
    if (!dragging) return;
    setDragX(Math.max(0, Math.min(maxX.current, e.clientX - startX.current)));
  }

  return (
    <div className="space-y-1">
      <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Advance stage</p>
      <div
        ref={trackRef}
        className={['relative h-14 min-h-14 rounded-full bg-muted', disabled ? 'opacity-50' : ''].join(' ')}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-status-running/25"
          style={{
            width: `${dragX + 48}px`,
            transition: dragging ? 'none' : 'width 180ms ease-out',
          }}
        />
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-14 text-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Swipe · Next: {nextLabel}
        </p>
        <button
          type="button"
          disabled={disabled}
          className="absolute top-1 left-1 flex h-12 w-12 min-h-12 min-w-12 items-center justify-center rounded-full border border-border bg-background text-primary shadow-sm touch-none disabled:opacity-50 active:scale-95"
          style={{
            transform: `translateX(${dragX}px)`,
            transition: dragging ? 'none' : 'transform 180ms ease-out',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => void onPointerUp()}
          onPointerCancel={() => { setDragging(false); setDragX(0); }}
          aria-label="Swipe to advance stage"
        >
          <ChevronsRight className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function ReadingField({
  id,
  label,
  unit,
  value,
  onChange,
  onEnterNext,
  disabled,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  onChange: (v: string) => void;
  onEnterNext: () => void;
  disabled?: boolean;
}) {
  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnterNext();
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={disabled}
          value={value}
          placeholder="—"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            const el = e.currentTarget;
            if (el.disabled) return;
            requestAnimationFrame(() => {
              el.focus({ preventScroll: true });
              try {
                const len = el.value.length;
                el.setSelectionRange(len, len);
              } catch {
                /* ignore */
              }
            });
          }}
          className={[
            'h-14 min-h-14 w-full rounded-lg border border-input bg-background px-3 text-center text-base font-mono tabular-nums',
            'touch-manipulation transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-primary/40',
            unit ? 'pr-11' : '',
            disabled ? 'opacity-50' : '',
          ].join(' ')}
          aria-label={unit ? `${label} ${unit}` : label}
        />
        {unit ? (
          <span className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
}

