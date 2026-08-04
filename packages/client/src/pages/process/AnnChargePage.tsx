import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
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
import { apiClient } from '../../lib/apiClient';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { useProcessStore, type ProcessQueueCard } from '../../store/processStore';
import { useShiftStore } from '../../store/shiftStore';
import type { Tone } from '../../lib/tones';

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

const EMPTY_READING = {
  chargeTemp: '',
  gasTemp: '',
  fcTemp: '',
  n2h2Flow: '',
  basePress: '',
  baseFanRpm: '',
  fuelFlow: '',
  rcfRpm: '',
};

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

/** Icon stage timeline — two rows with connector dots (Reading Entry mock). */
function ChargeDetailsTimeline({ stages, activeCode }: { stages: Stage[]; activeCode: string | null }) {
  const row1 = stages.filter((s) => s.seq <= 5);
  const row2 = stages.filter((s) => s.seq > 5);
  const [selected, setSelected] = useState<Stage | null>(null);

  function StageNode({ s }: { s: Stage }) {
    const done = Boolean(s.end_at) || s.skipped;
    const current = s.stage_code === activeCode && !done;
    const icon = STAGE_ICON[s.stage_code] ?? <ThermometerSnowflake className="h-4 w-4" strokeWidth={1.75} aria-hidden />;
    return (
      <li className="relative z-[1] flex flex-1 flex-col items-center gap-1 min-w-0">
        <button
          type="button"
          className={[
            'relative flex h-9 w-9 items-center justify-center rounded-full border-2 bg-background',
            done || current ? 'border-status-running text-status-running' : 'border-border text-muted-foreground',
            current ? 'ring-2 ring-status-running/30' : '',
            selected?.stage_code === s.stage_code ? 'ring-2 ring-ring' : '',
          ].join(' ')}
          title={humanizeStage(s.stage_code)}
          onClick={() => setSelected(s)}
        >
          <span className="scale-90">{icon}</span>
          {done && (
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-status-running text-primary-foreground">
              <Check className="h-2 w-2" strokeWidth={3} aria-hidden />
            </span>
          )}
        </button>
        <span
          className={[
            'text-[9px] text-center leading-tight font-medium px-0.5',
            current ? 'font-bold text-status-running' : 'text-muted-foreground',
          ].join(' ')}
        >
          {humanizeStage(s.stage_code)}
          {current ? ' · NOW' : ''}
        </span>
      </li>
    );
  }

  function StageRow({ items }: { items: Stage[] }) {
    if (items.length === 0) return null;
    const progressed = items.filter((s) => Boolean(s.end_at) || s.skipped || (s.stage_code === activeCode && s.start_at)).length;
    const fillPct = items.length <= 1 ? 0 : Math.min(100, ((Math.max(0, progressed - 1)) / (items.length - 1)) * 100);

    return (
      <div className="relative">
        <div className="absolute left-[10%] right-[10%] top-[18px] h-0.5 bg-border" aria-hidden />
        <div
          className="absolute left-[10%] top-[18px] h-0.5 bg-status-running transition-[width] duration-500"
          style={{ width: `calc(${fillPct}% * 0.8)` }}
          aria-hidden
        />
        <ol className="relative flex gap-1">
          {items.map((s) => (
            <StageNode key={s.stage_code} s={s} />
          ))}
        </ol>
      </div>
    );
  }

  const durationMin =
    selected?.start_at && selected?.end_at
      ? Math.max(0, Math.round((new Date(selected.end_at).getTime() - new Date(selected.start_at).getTime()) / 60_000))
      : null;

  return (
    <div className="space-y-3">
      <StageRow items={row1} />
      <StageRow items={row2} />
      {selected && (
        <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
          <p className="font-semibold text-foreground">{humanizeStage(selected.stage_code)}</p>
          <p className="text-muted-foreground mt-0.5">
            Start: {selected.start_at ? formatReadingTime(selected.start_at) : '—'}
            {' · '}End: {selected.end_at ? formatReadingTime(selected.end_at) : '—'}
            {durationMin != null ? ` · ${durationMin} min` : ''}
            {selected.skipped ? ' · SKIPPED' : ''}
          </p>
        </div>
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
    maxX.current = Math.max(120, track.clientWidth - 48);
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
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Advance stage</p>
      <div
        ref={trackRef}
        className={['relative h-10 min-h-10 rounded-full bg-muted', disabled ? 'opacity-50' : ''].join(' ')}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-status-running/20 transition-[width] duration-150"
          style={{ width: `${dragX + 36}px` }}
        />
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          Swipe to next stage
        </p>
        <button
          type="button"
          disabled={disabled}
          className="absolute top-1 left-1 flex h-8 w-8 min-h-8 items-center justify-center rounded-full bg-background text-primary shadow-sm border border-border touch-none disabled:opacity-50"
          style={{ transform: `translateX(${dragX}px)` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => void onPointerUp()}
          onPointerCancel={() => { setDragging(false); setDragX(0); }}
          aria-label="Swipe to advance stage"
        >
          <ChevronsRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div className="rounded-lg bg-status-running/10 border border-status-running/30 px-3 py-1.5 text-center">
        <p className="text-[10px] font-bold uppercase tracking-wide text-status-running">
          Next stage: {nextLabel}
        </p>
      </div>
    </div>
  );
}

function AnnPopup({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-primary/40 backdrop-blur-sm" aria-label="Close" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ann-popup-title"
        className="relative z-[1] flex max-h-[min(80dvh,36rem)] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-card px-4 py-3">
          <h2 id="ann-popup-title" className="text-base font-bold text-foreground">{title}</h2>
          <ZButton
            type="button"
            variant="ghost"
            size="sm"
            className="!h-10 !w-10 !min-h-10 !px-0 hover:bg-muted"
            aria-label="Close dialog"
            onClick={onClose}
          >
            <X className="h-5 w-5" aria-hidden />
          </ZButton>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

/** Reading Entry — matches operator console mock. */
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
  const [savedFlash, setSavedFlash] = useState(false);
  const [showPrev, setShowPrev] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [stopCategories, setStopCategories] = useState<{ category_code: string; description: string | null }[]>([]);
  const [stopCategory, setStopCategory] = useState('');
  const [stopReason, setStopReason] = useState('');

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
  }, [chargeNo, loadQueue]);

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
    } finally {
      setBusy(false);
    }
  }

  async function endStoppage(stoppageId: string | number) {
    setBusy(true);
    try {
      await apiClient.post('/stations/ann/charges', { action: 'stoppage-end', stoppageId: String(stoppageId) });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function saveReading() {
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
  }

  function clearReadingForm() {
    setReading(EMPTY_READING);
    setRemarks('');
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

  const nextLabel =
    active?.stage_code === 'UNLOADING'
      ? 'Complete unload'
      : nextStage
        ? humanizeStage(nextStage.stage_code)
        : '—';

  const openStoppage = (detail?.stoppages ?? []).find((s) => !s.end_at);
  const statusLabel =
    charge?.status === 'DONE' ? 'COMPLETE' : openStoppage ? 'STOPPAGE' : 'RUNNING';
  const statusTone: Tone =
    statusLabel === 'COMPLETE' ? 'info' : statusLabel === 'STOPPAGE' ? 'warning' : 'success';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-secondary">
      {/* Process header — matches CaptureWorkspace chrome */}
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-primary text-primary-foreground min-h-16">
        <div className="flex items-center gap-3 min-w-0">
          <ZButton
            type="button"
            variant="ghost"
            size="sm"
            className="!min-h-10 !h-10 !w-10 !px-0 text-primary-foreground hover:bg-white/10 hover:text-primary-foreground"
            aria-label="Back to bases"
            onClick={() => navigate(`${basePath}?tab=charges`)}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </ZButton>
          <p className="text-base font-bold shrink-0 hidden sm:block">Production Console</p>
          <span className="font-mono text-lg font-bold truncate">{batchLabel}</span>
          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-white/15 shrink-0">ANN</span>
          <span
            className={[
              'text-[10px] uppercase font-bold px-2 py-0.5 rounded shrink-0',
              statusLabel === 'STOPPAGE' ? 'bg-warning/90 text-warning-foreground' : 'bg-white/15',
            ].join(' ')}
          >
            {statusLabel}
          </span>
        </div>
        <ZButton
          type="button"
          variant="secondary"
          size="sm"
          className="shrink-0 !bg-white/10 !text-primary-foreground border border-white/25 hover:!bg-white/20"
          onClick={() => setRosterOpen(true)}
        >
          Order details
        </ZButton>
      </div>

      {detail && (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2 md:p-3">
          {openStoppage && (
            <div className="shrink-0 flex items-center justify-between rounded-lg border border-destructive bg-destructive text-white px-4 py-2 shadow-sm">
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-wide opacity-80">Stoppage active</p>
                <p className="text-sm font-semibold truncate">
                  {openStoppage.category_code}
                  {openStoppage.reason ? ` · ${openStoppage.reason}` : ''}
                </p>
              </div>
              <ZBadge tone="warning" label="STOPPAGE" />
            </div>
          )}

          <section className="shrink-0 rounded-lg border border-border bg-card p-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Current charge</h2>
              <ZBadge tone={statusTone} label={statusLabel} dot={statusLabel === 'RUNNING'} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[
                ['Base', String(charge?.base_no ?? '—')],
                ['Charge', chargeNo],
                ['Stage', humanizeStage(String(charge?.current_stage_code ?? '—'))],
                ['Stage start', stageStart],
                ['Temp', `${currentTemp}${currentTemp !== '—' ? ' °C' : ''}`],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
                  <p className="mt-0.5 truncate text-sm font-bold font-mono tabular-nums text-foreground">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="grid min-h-0 flex-1 gap-3 overflow-hidden md:grid-cols-[1fr_17rem] lg:grid-cols-[1fr_18rem] xl:grid-cols-[1fr_20rem]">
          <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-hidden">
            <section className="shrink-0 rounded-lg border border-border bg-background p-3 shadow-sm">
              <h2 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Charge details</h2>
              <ChargeDetailsTimeline
                stages={detail.stages}
                activeCode={String(charge?.current_stage_code ?? '') || null}
              />
              <div className="mt-1 flex flex-wrap gap-2">
                {detail.stages
                  .filter((s) => !s.skipped && !s.end_at && (s.stage_code === 'RAPID_COOL' || s.stage_code === 'WATER_COOL'))
                  .map((s) => (
                    <button
                      key={s.stage_code}
                      type="button"
                      className="min-h-8 text-xs font-medium text-muted-foreground underline hover:text-foreground"
                      onClick={() => void skipStage(s.stage_code)}
                    >
                      Skip {humanizeStage(s.stage_code)}
                    </button>
                  ))}
              </div>
            </section>

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background p-3 shadow-sm">
              <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Reading form</h2>
                {savedFlash && (
                  <span className="text-[10px] font-bold uppercase tracking-wide text-status-running">
                    Reading saved
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {([
                    ['chargeTemp', 'Charge Temp (°C)'],
                    ['gasTemp', 'Gas Temp (°C)'],
                    ['fcTemp', 'F/C Temp (°C)'],
                    ['n2h2Flow', 'N₂ / H₂ Flow'],
                    ['basePress', 'Base Pressure'],
                    ['baseFanRpm', 'Base Fan (RPM)'],
                    ['fuelFlow', 'Fuel Flow'],
                    ['rcfRpm', 'RCF RPM'],
                  ] as const).map(([k, label]) => (
                    <ZInput
                      key={k}
                      label={label}
                      type="number"
                      value={reading[k]}
                      placeholder="--"
                      onChange={(e) => setReading({ ...reading, [k]: e.target.value })}
                      className="!h-9 rounded-lg text-center text-sm"
                    />
                  ))}
                </div>
                <div className="mt-2">
                  <ZInput
                    id="ann-remarks"
                    label="Remarks"
                    placeholder="Add a note for this reading"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    mono={false}
                    className="!h-9 rounded-lg text-sm"
                  />
                </div>
              </div>
            </section>
          </div>

          <aside className="flex min-h-0 flex-col gap-3 overflow-hidden">
            <section className="shrink-0 rounded-lg border border-border bg-background p-3 shadow-sm">
              <SwipeAdvance
                disabled={busy || !active || charge?.status === 'DONE'}
                nextLabel={nextLabel}
                onAdvance={advanceStage}
              />
            </section>

            <section className="shrink-0 rounded-lg border border-border bg-background p-3 shadow-sm space-y-2">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Stoppage</h2>
              {(() => {
                const open = (detail.stoppages ?? []).find((s) => !s.end_at);
                if (open) {
                  return (
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-status-stopped">
                        Open: {open.category_code}
                        {open.reason ? ` · ${open.reason}` : ''}
                      </p>
                      <ZButton
                        type="button"
                        variant="secondary"
                        fullWidth
                        disabled={busy || charge?.status === 'DONE'}
                        onClick={() => void endStoppage(open.stoppage_id)}
                        className="!h-10 !min-h-10 rounded-lg"
                      >
                        End stoppage
                      </ZButton>
                    </div>
                  );
                }
                return (
                  <div className="space-y-2">
                    <select
                      className="h-10 min-h-10 w-full rounded-lg border border-input bg-background px-2 text-sm"
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
                    <ZInput
                      placeholder="Reason (optional)"
                      value={stopReason}
                      onChange={(e) => setStopReason(e.target.value)}
                      disabled={charge?.status === 'DONE'}
                      mono={false}
                      className="!h-10 rounded-lg"
                    />
                    <ZButton
                      type="button"
                      variant="danger"
                      fullWidth
                      disabled={busy || !stopCategory || charge?.status === 'DONE'}
                      onClick={() => void startStoppage()}
                      className="!h-10 !min-h-10 rounded-lg !bg-status-stopped/15 !text-status-stopped hover:!bg-status-stopped/25 !shadow-none"
                    >
                      Start stoppage
                    </ZButton>
                  </div>
                );
              })()}
            </section>

            <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background p-3 shadow-sm">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Last reading</h2>
              {last ? (
                <p className="mt-1 text-sm font-medium font-mono tabular-nums text-foreground">{formatReadingTime(last.taken_at)}</p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">No readings yet</p>
              )}
              <div className="mt-auto flex flex-col gap-2 pt-3">
                <ZButton
                  type="button"
                  variant="primary"
                  fullWidth
                  disabled={charge?.status === 'DONE'}
                  onClick={() => void saveReading()}
                  className="!h-11 !min-h-11 rounded-lg uppercase tracking-wide font-bold"
                >
                  <Check className="h-4 w-4" aria-hidden /> Save reading
                </ZButton>
                <ZButton
                  type="button"
                  variant="secondary"
                  fullWidth
                  onClick={clearReadingForm}
                  className="!h-11 !min-h-11 rounded-lg uppercase tracking-wide font-bold"
                >
                  <X className="h-4 w-4" aria-hidden /> Clear
                </ZButton>
                <ZButton
                  type="button"
                  variant="secondary"
                  fullWidth
                  onClick={() => setShowPrev(true)}
                  className="!h-11 !min-h-11 rounded-lg border border-border"
                >
                  View previous reading
                </ZButton>
              </div>
            </section>
          </aside>
          </div>
        </div>
      )}

      <AnnPopup open={rosterOpen} title="Order details" onClose={() => setRosterOpen(false)}>
        {detail ? (
          <div className="space-y-3">
            <ul className="space-y-2">
              {detail.roster.length === 0 && (
                <li className="text-sm text-muted-foreground">No coils on this batch yet.</li>
              )}
              {detail.roster.map((r) => (
                <li
                  key={r.coil_no}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm"
                >
                  <span className="font-mono tabular-nums">
                    {r.coil_no} · {r.grade_code ?? ''} · {Number(r.weight_mt ?? 0).toFixed(2)} MT
                  </span>
                  <div className="flex items-center gap-2">
                    {r.disposition === 'HOLD' && <ZBadge tone="accent" label="HOLD" />}
                    {r.disposition === 'REJECT' && <ZBadge tone="destructive" label="REJECT" />}
                    <select
                      className="h-10 min-h-10 rounded-lg border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    className="h-9 min-h-9 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                  className="min-h-9 h-9 rounded-lg"
                  onClick={() => coilToAdd && void rosterCoil(coilToAdd)}
                >
                  Add
                </ZButton>
              </div>
            )}
          </div>
        ) : null}
      </AnnPopup>

      <AnnPopup open={showPrev} title="Reading history" onClose={() => setShowPrev(false)}>
        {detail ? (
          <ul className="space-y-2">
            {detail.readings.length === 0 && (
              <li className="text-sm text-muted-foreground">No readings yet.</li>
            )}
            {detail.readings.map((r) => (
              <li key={r.reading_id} className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-mono tabular-nums">
                <p className="font-sans text-sm font-medium text-foreground">{formatReadingTime(r.taken_at)}</p>
                <p className="mt-0.5 text-muted-foreground">
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
        ) : null}
      </AnnPopup>
    </div>
  );
}
