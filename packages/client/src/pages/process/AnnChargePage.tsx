import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronLeft,
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
  X,
} from 'lucide-react';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { ZBadge } from '../../components/primitives/ZBadge';
import { ZDrawer } from '../../components/primitives/ZDrawer';
import { apiClient } from '../../lib/apiClient';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { useProcessStore, type ProcessQueueCard } from '../../store/processStore';
import { useShiftStore } from '../../store/shiftStore';

type Stage = {
  stage_id: string;
  stage_code: string;
  seq: number;
  start_at: string | null;
  end_at: string | null;
  duration_min: number | string | null;
  skipped: boolean;
};

type Reading = {
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

type RosterRow = {
  coil_no: string;
  seq_no: number | null;
  disposition: string;
  grade_code: string | null;
  weight_mt: number | string | null;
};

type Stoppage = {
  stoppage_id: string | number;
  category_code: string;
  start_at: string;
  end_at: string | null;
  duration_min: number | string | null;
  reason: string | null;
  remark: string | null;
};

type ReadingKey =
  | 'chargeTemp'
  | 'gasTemp'
  | 'fcTemp'
  | 'basePress'
  | 'baseFanRpm'
  | 'fuelFlow'
  | 'rcfRpm'
  | 'n2h2Flow';

const EMPTY_READING: Record<ReadingKey, string> = {
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
const READING_FIELDS: { key: ReadingKey; label: string; unit: string }[] = [
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
const STAGE_ICON: Record<string, ReactNode> = {
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

const STAGE_LABEL: Record<string, string> = {
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

function humanizeStage(code: string) {
  return STAGE_LABEL[code] ?? code.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatReadingTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatElapsed(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return '—';
  const min = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60_000));
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

function MetaInline({ label, value, onPrimary }: { label: string; value: string; onPrimary?: boolean }) {
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
function ChargeDetailsTimeline({ stages, activeCode, nowMs }: { stages: Stage[]; activeCode: string | null; nowMs: number }) {
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

function SwipeAdvance({
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

function ReadingField({
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

/** Reading Entry — ANN operator production console. */
export function AnnChargePage() {
  const { chargeNo = '' } = useParams();
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const { queue, loadQueue } = useProcessStore();
  const shiftCode = useShiftStore((s) => s.shiftCode);
  const [detail, setDetail] = useState<{
    charge: Record<string, unknown>;
    roster: RosterRow[];
    stages: Stage[];
    readings: Reading[];
    stoppages: Stoppage[];
  } | null>(null);
  const [coilToAdd, setCoilToAdd] = useState('');
  const [reading, setReading] = useState(EMPTY_READING);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showPrev, setShowPrev] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [stoppageOpen, setStoppageOpen] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [stopCategories, setStopCategories] = useState<{ category_code: string; description: string | null }[]>([]);
  const [stopCategory, setStopCategory] = useState('');
  const [stopReason, setStopReason] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const remarksRef = useRef<HTMLTextAreaElement | null>(null);

  async function reload() {
    const d = await apiClient.get<{
      charge: Record<string, unknown>;
      roster: RosterRow[];
      stages: Stage[];
      readings: Reading[];
      stoppages: Stoppage[];
    }>(`/stations/ann/charges/${encodeURIComponent(chargeNo)}`);
    setDetail(d);
  }

  useEffect(() => {
    void loadQueue();
    void reload();
    void apiClient
      .get<{ categories: { category_code: string; description: string | null }[] }>('/stations/ann/stoppage-categories')
      .then((r) => {
        setStopCategories(r.categories ?? []);
        if (r.categories?.[0]) setStopCategory(r.categories[0].category_code);
      })
      .catch(() => undefined);
    // ponytail: same deps as before — reload is chargeNo-scoped, not a stable callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargeNo, loadQueue]);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  async function rosterCoil(coilNo: string) {
    await apiClient.post('/stations/ann/charges', { action: 'roster', chargeNo, coilNo });
    setCoilToAdd('');
    await reload();
  }

  async function setDisposition(coilNo: string, disposition: 'ADVANCE' | 'HOLD' | 'REJECT') {
    await apiClient.post('/stations/ann/charges', { action: 'disposition', chargeNo, coilNo, disposition });
    await reload();
  }

  async function advanceStage() {
    setBusy(true);
    try {
      const r = await apiClient.post<{ done?: boolean }>('/stations/ann/charges', { action: 'advance-stage', chargeNo });
      await reload();
      if (r.done) navigate(`${basePath}?tab=charges`);
    } finally {
      setBusy(false);
    }
  }

  async function skipStage(stageCode: string) {
    const authorizedBy = Number(prompt('Machine Head user id (authorize skip)') ?? '');
    if (!authorizedBy) return;
    const reason = prompt('Skip reason') ?? undefined;
    await apiClient.post('/stations/ann/charges', { action: 'skip-stage', chargeNo, stageCode, authorizedBy, skipReason: reason });
    await reload();
  }

  async function startStoppage() {
    if (!stopCategory || detail?.charge?.status === 'DONE') return;
    setBusy(true);
    try {
      await apiClient.post('/stations/ann/charges', {
        action: 'stoppage-start',
        chargeNo,
        categoryCode: stopCategory,
        reason: stopReason || undefined,
      });
      setStopReason('');
      await reload();
      setStoppageOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function endStoppage(stoppageId: string | number) {
    setBusy(true);
    try {
      await apiClient.post('/stations/ann/charges', { action: 'stoppage-end', stoppageId: String(stoppageId) });
      await reload();
      setStoppageOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function saveReading() {
    if (saving || detail?.charge?.status === 'DONE') return;
    setSaving(true);
    try {
      await apiClient.post('/stations/ann/charges', {
        action: 'reading',
        chargeNo,
        shiftCode: shiftCode ?? undefined,
        chargeTemp: reading.chargeTemp === '' ? undefined : Number(reading.chargeTemp),
        gasTemp: reading.gasTemp === '' ? undefined : Number(reading.gasTemp),
        fcTemp: reading.fcTemp === '' ? undefined : Number(reading.fcTemp),
        n2h2Flow: reading.n2h2Flow === '' ? undefined : Number(reading.n2h2Flow),
        basePress: reading.basePress === '' ? undefined : Number(reading.basePress),
        baseFanRpm: reading.baseFanRpm === '' ? undefined : Number(reading.baseFanRpm),
        fuelFlow: reading.fuelFlow === '' ? undefined : Number(reading.fuelFlow),
        rcfRpm: reading.rcfRpm === '' ? undefined : Number(reading.rcfRpm),
      });
      setReading(EMPTY_READING);
      setRemarks('');
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 2500);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  function clearReadingForm() {
    setReading(EMPTY_READING);
    setRemarks('');
  }

  function focusNextField(index: number) {
    const next = READING_FIELDS[index + 1];
    if (next) {
      document.getElementById(`ann-rf-${next.key}`)?.focus();
      return;
    }
    remarksRef.current?.focus();
  }

  const pendingCoils = queue.filter((c: ProcessQueueCard) => c.status === 'PENDING');
  const active = detail?.stages.find((s) => s.start_at && !s.end_at && !s.skipped);
  const nextStage = useMemo(() => {
    if (!detail || !active) return null;
    return detail.stages.find((s) => s.seq === active.seq + 1) ?? null;
  }, [detail, active]);
  const last = detail?.readings[0] ?? null;
  const charge = detail?.charge;
  const batchLabel = String(charge?.annealing_batch_no ?? chargeNo);
  const currentTemp = last?.charge_temp ?? (reading.chargeTemp || '—');
  const stageStart = active?.start_at ? formatReadingTime(active.start_at) : '—';
  const stageElapsed = formatElapsed(active?.start_at, nowMs);
  const stagesDone = (detail?.stages ?? []).filter((s) => Boolean(s.end_at) || s.skipped).length;
  const stagesTotal = Math.max(1, detail?.stages?.length ?? 1);
  const progressPct = Math.round((stagesDone / stagesTotal) * 100);

  const nextLabel =
    active?.stage_code === 'UNLOADING'
      ? 'Complete unload'
      : nextStage
        ? humanizeStage(nextStage.stage_code)
        : '—';

  const openStoppage = (detail?.stoppages ?? []).find((s) => !s.end_at);
  const statusLabel =
    charge?.status === 'DONE' ? 'COMPLETE' : openStoppage ? 'STOPPAGE' : 'RUNNING';

  const skippable = (detail?.stages ?? []).filter(
    (s) => !s.skipped && !s.end_at && (s.stage_code === 'RAPID_COOL' || s.stage_code === 'WATER_COOL'),
  );

  const headerSegBtn =
    'min-h-10 h-10 rounded-full px-3.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-secondary">
      <div className="relative z-10 shrink-0 bg-primary text-primary-foreground shadow-sm">
        <div className="flex flex-wrap items-center gap-2 px-3 pt-3 pb-2 md:px-4">
          <ZButton
            type="button"
            variant="ghost"
            size="sm"
            className="!min-h-11 !h-11 !w-11 !px-0 shrink-0 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
            aria-label="Back to bases"
            onClick={() => navigate(`${basePath}?tab=charges`)}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </ZButton>
          <div className="min-w-0 flex flex-1 items-center gap-2">
            <span className="font-mono text-base font-bold truncate">{batchLabel}</span>
            <span className="text-[9px] uppercase font-bold px-2 py-0.5 rounded-full bg-white/15 shrink-0">ANN</span>
            <span
              className={[
                'text-[9px] uppercase font-bold px-2.5 py-1 rounded-full shrink-0',
                statusLabel === 'STOPPAGE'
                  ? 'bg-warning text-warning-foreground'
                  : statusLabel === 'COMPLETE'
                    ? 'bg-white/20'
                    : 'bg-status-running/90 text-primary-foreground',
              ].join(' ')}
            >
              {statusLabel}
            </span>
          </div>

          <div
            className="inline-flex shrink-0 items-center rounded-full border border-white/25 bg-black/10 p-0.5 max-sm:w-full max-sm:justify-stretch sm:ml-auto"
            role="group"
            aria-label="Console actions"
          >
            <button type="button" className={[headerSegBtn, 'flex-1 text-primary-foreground hover:bg-white/15'].join(' ')} onClick={() => setShowPrev(true)}>
              History
            </button>
            <button type="button" className={[headerSegBtn, 'flex-1 text-primary-foreground hover:bg-white/15'].join(' ')} onClick={() => setRosterOpen(true)}>
              Orders
            </button>
            <button
              type="button"
              className={[
                headerSegBtn,
                'flex-1',
                openStoppage ? 'bg-warning text-warning-foreground' : 'text-primary-foreground hover:bg-white/15',
              ].join(' ')}
              onClick={() => setStoppageOpen(true)}
            >
              Stoppage
            </button>
          </div>
        </div>

        {detail && (
          <div className="border-t border-white/15 bg-primary/95 px-3 pt-3.5 pb-3 md:px-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
                <MetaInline onPrimary label="Base" value={String(charge?.base_no ?? '—')} />
                <MetaInline onPrimary label="Charge" value={chargeNo} />
                <MetaInline onPrimary label="Stage" value={humanizeStage(String(charge?.current_stage_code ?? '—'))} />
                <MetaInline onPrimary label="Start" value={stageStart} />
                <MetaInline onPrimary label="Elapsed" value={stageElapsed} />
                <MetaInline onPrimary label="Temp" value={`${currentTemp}${currentTemp !== '—' ? ' °C' : ''}`} />
                <MetaInline onPrimary label="Shift" value={shiftCode ? String(shiftCode) : '—'} />
              </div>
              <div className="flex w-full shrink-0 flex-col gap-1.5 lg:w-44">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-bold uppercase leading-none tracking-[0.12em] text-primary-foreground/70">Progress</span>
                  <span className="font-mono text-xs font-bold tabular-nums text-primary-foreground">
                    {progressPct}% · {stagesDone}/{stagesTotal}
                  </span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-status-running transition-[width] duration-500" style={{ width: `${progressPct}%` }} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {detail && (
        <div className="grid min-h-0 flex-1 gap-2.5 overflow-hidden p-2.5 pt-3 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="flex min-h-0 min-w-0 flex-col gap-2.5 overflow-hidden">
            <section className="z-card shrink-0 px-3 py-2.5">
              <ChargeDetailsTimeline
                stages={detail.stages}
                activeCode={String(charge?.current_stage_code ?? '') || null}
                nowMs={nowMs}
              />
            </section>

            <section className="z-card flex min-h-0 flex-1 flex-col overflow-hidden p-3">
              <div className="mb-2.5 flex shrink-0 items-center justify-between gap-2">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Reading entry</h2>
                <div className="flex items-center gap-2">
                  {saving && <span className="text-[10px] font-bold uppercase text-muted-foreground animate-pulse">Saving…</span>}
                  {!saving && savedFlash && (
                    <span className="rounded-full bg-status-running/15 px-2 py-0.5 text-[10px] font-bold uppercase text-status-running animate-fade-in">
                      Reading saved
                    </span>
                  )}
                  {last && (
                    <span className="truncate font-mono text-[10px] tabular-nums text-muted-foreground">
                      Last {formatReadingTime(last.taken_at)}
                    </span>
                  )}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
                <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3">
                  {READING_FIELDS.map((f, idx) => (
                    <ReadingField
                      key={f.key}
                      id={`ann-rf-${f.key}`}
                      label={f.label}
                      unit={f.unit}
                      value={reading[f.key]}
                      disabled={charge?.status === 'DONE'}
                      onChange={(v) => setReading({ ...reading, [f.key]: v })}
                      onEnterNext={() => focusNextField(idx)}
                    />
                  ))}
                </div>

                <div className="mt-3 flex flex-col gap-1 pb-1">
                  <label htmlFor="ann-remarks" className="text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Remarks
                  </label>
                  <textarea
                    ref={remarksRef}
                    id="ann-remarks"
                    placeholder="Optional note"
                    value={remarks}
                    disabled={charge?.status === 'DONE'}
                    rows={3}
                    onChange={(e) => {
                      setRemarks(e.target.value);
                      const el = e.target;
                      el.style.height = 'auto';
                      el.style.height = `${Math.min(Math.max(el.scrollHeight, 72), 160)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void saveReading();
                      }
                    }}
                    className="min-h-[4.5rem] max-h-40 w-full resize-none overflow-y-auto rounded-lg border border-input bg-background px-3 py-2.5 text-sm touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  />
                </div>
              </div>
            </section>
          </div>

          <aside className="z-card flex min-h-0 flex-col overflow-hidden p-3">
            <h2 className="mb-2.5 shrink-0 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Operator action center</h2>

            <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain">
              <SwipeAdvance
                disabled={busy || !active || charge?.status === 'DONE'}
                nextLabel={nextLabel}
                onAdvance={advanceStage}
              />

              {skippable.length > 0 && (
                <div className="flex flex-col gap-2">
                  {skippable.map((s) => (
                    <ZButton
                      key={s.stage_code}
                      type="button"
                      variant="secondary"
                      fullWidth
                      className="!h-12 !min-h-12 rounded-lg text-xs"
                      onClick={() => void skipStage(s.stage_code)}
                    >
                      Skip {humanizeStage(s.stage_code)}
                    </ZButton>
                  ))}
                </div>
              )}

              {openStoppage ? (
                <div className="space-y-2 rounded-lg border border-status-stopped/40 bg-status-stopped/10 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-status-stopped">Active stoppage</p>
                    <ZBadge tone="warning" label="OPEN" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">
                    {openStoppage.category_code}
                    {openStoppage.reason ? ` · ${openStoppage.reason}` : ''}
                  </p>
                  <p className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    Started {formatReadingTime(openStoppage.start_at)} · {formatElapsed(openStoppage.start_at, nowMs)}
                  </p>
                  <ZButton
                    type="button"
                    variant="danger"
                    fullWidth
                    disabled={busy || charge?.status === 'DONE'}
                    onClick={() => void endStoppage(openStoppage.stoppage_id)}
                    className="!h-12 !min-h-12 rounded-lg uppercase tracking-wide text-xs font-bold"
                  >
                    End stoppage
                  </ZButton>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={charge?.status === 'DONE'}
                  onClick={() => setStoppageOpen(true)}
                  className="flex h-12 min-h-12 w-full items-center justify-center rounded-lg border border-dashed border-border text-xs font-bold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  Open stoppage…
                </button>
              )}
            </div>

            <div className="mt-auto flex shrink-0 flex-col gap-2 border-t border-border pt-3">
              <ZButton
                type="button"
                variant="primary"
                fullWidth
                disabled={charge?.status === 'DONE' || saving}
                onClick={() => void saveReading()}
                className="!h-14 !min-h-14 rounded-lg uppercase tracking-wide text-sm font-bold active:scale-[0.99]"
              >
                <Check className="h-5 w-5" aria-hidden />
                {saving ? 'Saving…' : 'Save reading'}
              </ZButton>
              <ZButton
                type="button"
                variant="secondary"
                fullWidth
                onClick={clearReadingForm}
                className="!h-12 !min-h-12 rounded-lg uppercase tracking-wide text-xs font-bold"
              >
                <X className="h-4 w-4" aria-hidden /> Clear
              </ZButton>
            </div>
          </aside>
        </div>
      )}

      <ZDrawer open={stoppageOpen} onClose={() => setStoppageOpen(false)} title="Stoppage" size="medium">
        <div className="space-y-4 p-4">
          {openStoppage ? (
            <>
              <div className="rounded-lg border border-status-stopped/40 bg-status-stopped/10 px-3 py-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-status-stopped">Active stoppage</p>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {openStoppage.category_code}
                  {openStoppage.reason ? ` · ${openStoppage.reason}` : ''}
                </p>
                <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">
                  Since {formatReadingTime(openStoppage.start_at)} · {formatElapsed(openStoppage.start_at, nowMs)}
                </p>
              </div>
              <ZButton
                type="button"
                variant="danger"
                fullWidth
                disabled={busy || charge?.status === 'DONE'}
                onClick={() => void endStoppage(openStoppage.stoppage_id)}
                className="!h-14 !min-h-14 rounded-lg uppercase tracking-wide font-bold"
              >
                End stoppage
              </ZButton>
            </>
          ) : (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Category</span>
                <select
                  className="h-14 min-h-14 w-full rounded-lg border border-input bg-background px-3 text-base"
                  value={stopCategory}
                  onChange={(e) => setStopCategory(e.target.value)}
                  disabled={charge?.status === 'DONE'}
                  aria-label="Stoppage category"
                >
                  {stopCategories.map((c) => (
                    <option key={c.category_code} value={c.category_code}>
                      {c.description ?? c.category_code}
                    </option>
                  ))}
                </select>
              </label>
              <ZInput
                label="Reason (optional)"
                placeholder="Optional note"
                value={stopReason}
                onChange={(e) => setStopReason(e.target.value)}
                disabled={charge?.status === 'DONE'}
                mono={false}
                className="!h-14 !min-h-14 rounded-lg"
              />
              <ZButton
                type="button"
                variant="danger"
                fullWidth
                disabled={busy || !stopCategory || charge?.status === 'DONE'}
                onClick={() => void startStoppage()}
                className="!h-14 !min-h-14 rounded-lg uppercase tracking-wide font-bold"
              >
                Start stoppage
              </ZButton>
            </>
          )}
        </div>
      </ZDrawer>

      <ZDrawer open={rosterOpen} onClose={() => setRosterOpen(false)} title="Orders" size="medium">
        <div className="space-y-3 p-4">
          {detail ? (
            <>
              <ul className="space-y-2">
                {detail.roster.length === 0 && (
                  <li className="text-sm text-muted-foreground">No coils on this batch yet.</li>
                )}
                {detail.roster.map((r) => (
                  <li
                    key={r.coil_no}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-sm"
                  >
                    <span className="font-mono tabular-nums">
                      {r.coil_no} · {r.grade_code ?? ''} · {Number(r.weight_mt ?? 0).toFixed(2)} MT
                    </span>
                    <div className="flex items-center gap-2">
                      {r.disposition === 'HOLD' && <ZBadge tone="accent" label="HOLD" />}
                      {r.disposition === 'REJECT' && <ZBadge tone="destructive" label="REJECT" />}
                      <select
                        className="h-12 min-h-12 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={r.disposition}
                        onChange={(e) => void setDisposition(r.coil_no, e.target.value as 'ADVANCE' | 'HOLD' | 'REJECT')}
                        aria-label={`Disposition for ${r.coil_no}`}
                      >
                        <option value="ADVANCE">ADVANCE</option>
                        <option value="HOLD">HOLD</option>
                        <option value="REJECT">REJECT</option>
                      </select>
                    </div>
                  </li>
                ))}
              </ul>
              {detail.charge.status !== 'DONE' && (
                <div className="flex items-end gap-2 border-t border-border pt-3">
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Add coil</label>
                    <select
                      className="h-12 min-h-12 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={coilToAdd}
                      onChange={(e) => setCoilToAdd(e.target.value)}
                    >
                      <option value="">Add coil from queue…</option>
                      {pendingCoils.map((c) => (
                        <option key={c.coilNo} value={c.coilNo}>{c.coilNo}</option>
                      ))}
                    </select>
                  </div>
                  <ZButton
                    type="button"
                    variant="primary"
                    className="min-h-12 h-12 rounded-lg px-4"
                    onClick={() => coilToAdd && void rosterCoil(coilToAdd)}
                  >
                    Add
                  </ZButton>
                </div>
              )}
            </>
          ) : null}
        </div>
      </ZDrawer>

      <ZDrawer open={showPrev} onClose={() => setShowPrev(false)} title="Reading history" size="medium">
        <ul className="space-y-2 p-4">
          {detail?.readings.length === 0 && (
            <li className="text-sm text-muted-foreground">No readings yet.</li>
          )}
          {(detail?.readings ?? []).map((r) => (
            <li key={r.reading_id} className="rounded-lg border border-border bg-card px-3 py-2.5 text-xs font-mono tabular-nums">
              <p className="font-sans text-sm font-medium text-foreground">{formatReadingTime(r.taken_at)}</p>
              <p className="mt-1 text-muted-foreground">
                Stage {r.stage_code ?? '—'}
                {' · '}C {r.charge_temp ?? '—'}
                {' · '}G {r.gas_temp ?? '—'}
                {' · '}FC {r.fc_temp ?? '—'}
                {' · '}P {r.base_press ?? '—'}
                {' · '}Fan {r.base_fan_rpm ?? '—'}
              </p>
            </li>
          ))}
        </ul>
      </ZDrawer>
    </div>
  );
}
