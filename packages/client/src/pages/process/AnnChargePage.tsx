import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Check,
  ChevronLeft,
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
import { AnnBaseAssignModal } from '../../components/process/bodies/AnnBaseAssignModal';
import {
  EMPTY_READING,
  READING_FIELDS,
  ChargeDetailsTimeline,
  MetaInline,
  ReadingField,
  SwipeAdvance,
  formatDurationMin,
  formatElapsed,
  formatReadingTime,
  humanizeStage,
  type Reading,
  type RosterRow,
  type Stage,
  type Stoppage,
} from './AnnChargePanels';

// PERF-B3 ? thin container; widgets in AnnChargePanels
/** Reading Entry ? ANN operator production console. */
export function AnnChargePage() {
  const { chargeNo = '' } = useParams();
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const queue = useProcessStore((s) => s.queue);
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
  const [assignOpen, setAssignOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
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
    void useProcessStore.getState().loadQueue();
    void reload();
    void apiClient
      .get<{ categories: { category_code: string; description: string | null }[] }>('/stations/ann/stoppage-categories')
      .then((r) => {
        setStopCategories(r.categories ?? []);
        if (r.categories?.[0]) setStopCategory(r.categories[0].category_code);
      })
      .catch(() => undefined);
    // ponytail: same deps as before ? reload is chargeNo-scoped, not a stable callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargeNo]);

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
    setActionError(null);
    try {
      const r = await apiClient.post<{ done?: boolean }>('/stations/ann/charges', { action: 'advance-stage', chargeNo });
      await reload();
      if (r.done) navigate(`${basePath}?tab=charges`);
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Advance failed');
    } finally {
      setBusy(false);
    }
  }

  async function startCharge() {
    setBusy(true);
    setActionError(null);
    try {
      await apiClient.post(`/stations/ann/charges/${encodeURIComponent(chargeNo)}/start`);
      await reload();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Start failed');
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

  const pendingCoils = queue.filter((c: ProcessQueueCard) =>
    c.status === 'PENDING' || c.status === 'PREPARING' || c.status === 'IN_PROGRESS',
  );
  const active = detail?.stages.find((s) => s.start_at && !s.end_at && !s.skipped);
  const nextStage = useMemo(() => {
    if (!detail || !active) return null;
    return detail.stages.find((s) => s.seq === active.seq + 1) ?? null;
  }, [detail, active]);
  const last = detail?.readings[0] ?? null;
  const charge = detail?.charge;
  const batchLabel = String(charge?.annealing_batch_no ?? chargeNo);
  const needsBase = !charge?.base_no;
  const isPreparing = charge?.status === 'PREPARING' || needsBase;
  const currentTemp = last?.charge_temp ?? (reading.chargeTemp || '?');
  const stageStart = active?.start_at ? formatReadingTime(active.start_at) : '?';
  const stageElapsed = formatElapsed(active?.start_at, nowMs);
  const stagesDone = (detail?.stages ?? []).filter((s) => Boolean(s.end_at) || s.skipped).length;
  const stagesTotal = Math.max(1, detail?.stages?.length ?? 1);
  const progressPct = Math.round((stagesDone / stagesTotal) * 100);

  const nextLabel =
    active?.stage_code === 'UNLOADING'
      ? 'Complete unload'
      : nextStage
        ? humanizeStage(nextStage.stage_code)
        : '?';

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
                openStoppage
                  ? 'bg-accent text-accent-foreground shadow-sm'
                  : 'text-primary-foreground hover:bg-white/15',
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
                <MetaInline onPrimary label="Base" value={String(charge?.base_no ?? 'unassigned')} />
                <MetaInline onPrimary label="Charge" value={chargeNo} />
                <MetaInline onPrimary label="Status" value={isPreparing ? 'Preparing' : String(charge?.status ?? '?')} />
                <MetaInline onPrimary label="Stage" value={humanizeStage(String(charge?.current_stage_code ?? '?'))} />
                <MetaInline onPrimary label="Start" value={stageStart} />
                <MetaInline onPrimary label="Elapsed" value={stageElapsed} />
                <MetaInline onPrimary label="Anneal time" value={formatDurationMin(charge?.total_active_min as number | string | null)} />
                <MetaInline onPrimary label="Temp" value={`${currentTemp}${currentTemp !== '?' ? ' °C' : ''}`} />
                <MetaInline onPrimary label="Shift" value={shiftCode ? String(shiftCode) : '?'} />
              </div>
              <div className="flex w-full shrink-0 flex-col gap-1.5 lg:w-44">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[9px] font-bold uppercase leading-none tracking-[0.12em] text-primary-foreground/70">Progress</span>
                  <span className="font-mono text-xs font-bold tabular-nums text-primary-foreground">
                    {progressPct}% ? {stagesDone}/{stagesTotal}
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
                  {saving && <span className="text-[10px] font-bold uppercase text-muted-foreground animate-pulse">Saving?</span>}
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
              {actionError && <p className="text-sm text-destructive">{actionError}</p>}
              {needsBase && (
                <ZButton type="button" variant="primary" fullWidth disabled={busy} onClick={() => setAssignOpen(true)}>
                  Assign Base
                </ZButton>
              )}
              {isPreparing && !needsBase && (
                <ZButton type="button" variant="primary" fullWidth disabled={busy} onClick={() => void startCharge()}>
                  Start / In Progress
                </ZButton>
              )}
              <SwipeAdvance
                disabled={busy || isPreparing || !active || charge?.status === 'DONE' || Boolean(openStoppage)}
                nextLabel={nextLabel}
                onAdvance={advanceStage}
              />
              {openStoppage ? (
                <p className="text-xs text-warning">End stoppage to advance</p>
              ) : null}

              {skippable.length > 0 && (
                <div className="flex flex-col gap-2">
                  {skippable.map((s) => (
                    <ZButton
                      key={s.stage_code}
                      type="button"
                      variant="secondary"
                      fullWidth
                      className="!h-12 !min-h-12 rounded-lg text-xs"
                      disabled={busy || Boolean(openStoppage)}
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
                  className="flex h-12 min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent text-accent-foreground text-xs font-bold uppercase tracking-wide shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  Open stoppage
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
                {saving ? 'Saving?' : 'Save reading'}
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

      <ZDrawer open={rosterOpen} onClose={() => setRosterOpen(false)} title="Orders · charge coils" size="large">
        <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 border-b border-border bg-secondary/50 px-4 py-3">
            <p className="text-sm font-semibold text-foreground">
              {detail?.roster.length ?? 0} coil{(detail?.roster.length ?? 0) === 1 ? '' : 's'} on this charge
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Set disposition per coil · ADVANCE / HOLD / REJECT
            </p>
          </div>
          <div className="flex-1 min-h-0 overflow-auto p-4 space-y-3">
            {detail ? (
              <>
                {detail.roster.length === 0 && (
                  <p className="rounded-lg border border-dashed border-border bg-secondary/30 px-4 py-8 text-center text-sm text-muted-foreground">
                    No coils on this batch yet.
                  </p>
                )}
                {detail.roster.map((r) => (
                  <article
                    key={r.coil_no}
                    className="rounded-xl border border-border bg-card p-3 shadow-sm space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Coil</p>
                        <p className="font-mono text-base font-bold tabular-nums text-foreground truncate">{r.coil_no}</p>
                      </div>
                      {r.disposition === 'HOLD' && <ZBadge tone="accent" label="HOLD" />}
                      {r.disposition === 'REJECT' && <ZBadge tone="destructive" label="REJECT" />}
                      {r.disposition === 'ADVANCE' && <ZBadge tone="success" label="ADVANCE" />}
                    </div>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Grade</dt>
                        <dd className="font-mono font-semibold tabular-nums">{r.grade_code || '—'}</dd>
                      </div>
                      <div>
                        <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Weight</dt>
                        <dd className="font-mono font-semibold tabular-nums">{Number(r.weight_mt ?? 0).toFixed(2)} MT</dd>
                      </div>
                    </dl>
                    <label className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Disposition</span>
                      <select
                        className="h-12 min-h-12 rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        value={r.disposition}
                        onChange={(e) => void setDisposition(r.coil_no, e.target.value as 'ADVANCE' | 'HOLD' | 'REJECT')}
                        aria-label={`Disposition for ${r.coil_no}`}
                      >
                        <option value="ADVANCE">ADVANCE</option>
                        <option value="HOLD">HOLD</option>
                        <option value="REJECT">REJECT</option>
                      </select>
                    </label>
                  </article>
                ))}
              </>
            ) : null}
          </div>
          {detail && detail.charge.status !== 'DONE' && (
            <div className="shrink-0 border-t border-border bg-card px-4 py-3 flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">Add coil from queue</label>
                <select
                  className="h-12 min-h-12 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={coilToAdd}
                  onChange={(e) => setCoilToAdd(e.target.value)}
                >
                  <option value="">Select coil…</option>
                  {pendingCoils.map((c) => (
                    <option key={c.coilNo} value={c.coilNo}>{c.coilNo}</option>
                  ))}
                </select>
              </div>
              <ZButton
                type="button"
                variant="primary"
                className="min-h-12 h-12 rounded-lg px-5 font-bold"
                disabled={!coilToAdd}
                onClick={() => coilToAdd && void rosterCoil(coilToAdd)}
              >
                Add
              </ZButton>
            </div>
          )}
        </div>
      </ZDrawer>

      <ZDrawer open={showPrev} onClose={() => setShowPrev(false)} title="History · readings" size="large">
        <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 border-b border-border bg-secondary/50 px-4 py-3">
            <p className="text-sm font-semibold text-foreground">
              {(detail?.readings ?? []).length} reading{(detail?.readings ?? []).length === 1 ? '' : 's'} this charge
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">Newest first · temps, pressure, fan</p>
          </div>
          <ul className="flex-1 min-h-0 overflow-auto space-y-3 p-4">
            {(detail?.readings ?? []).length === 0 && (
              <li className="rounded-lg border border-dashed border-border bg-secondary/30 px-4 py-8 text-center text-sm text-muted-foreground">
                No readings yet.
              </li>
            )}
            {[...(detail?.readings ?? [])].reverse().map((r) => (
              <li key={r.reading_id} className="rounded-xl border border-border bg-card p-3 shadow-sm space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Taken</p>
                    <p className="font-mono text-sm font-bold tabular-nums text-foreground">{formatReadingTime(r.taken_at)}</p>
                  </div>
                  <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-foreground">
                    {humanizeStage(String(r.stage_code ?? '?'))}
                  </span>
                </div>
                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-3 gap-y-2.5 text-sm">
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Charge °C</dt>
                    <dd className="font-mono font-semibold tabular-nums">{r.charge_temp ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Gas °C</dt>
                    <dd className="font-mono font-semibold tabular-nums">{r.gas_temp ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">FC °C</dt>
                    <dd className="font-mono font-semibold tabular-nums">{r.fc_temp ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Pressure</dt>
                    <dd className="font-mono font-semibold tabular-nums">{r.base_press ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Fan RPM</dt>
                    <dd className="font-mono font-semibold tabular-nums">{r.base_fan_rpm ?? '—'}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      </ZDrawer>
      <AnnBaseAssignModal
        open={assignOpen}
        chargeNo={chargeNo}
        title="Assign base"
        confirmLabel="Assign Base"
        onClose={() => setAssignOpen(false)}
        onAssigned={async (baseNo) => {
          await apiClient.post(`/stations/ann/charges/${encodeURIComponent(chargeNo)}/assign-base`, { baseNo });
          await reload();
        }}
      />
    </div>
  );
}
