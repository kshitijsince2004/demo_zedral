import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronLeft, ChevronsRight } from 'lucide-react';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../../components/primitives/ZButton';
import { ZBadge } from '../../../components/primitives/ZBadge';
import { apiClient } from '../../../lib/apiClient';
import type { Tone } from '../../../lib/tones';

type Stage = { stage_code: string; seq: number; start_at: string | null; end_at: string | null; skipped: boolean };
type Reading = {
  reading_id: string; taken_at: string; stage_code: string | null;
  charge_temp: number | string | null; gas_temp: number | string | null; fc_temp: number | string | null;
  base_press: number | string | null; base_fan_rpm: number | string | null;
  n2h2_flow: number | string | null; fuel_flow: number | string | null; rcf_rpm: number | string | null;
};
type Stoppage = {
  stoppage_id: string | number; category_code: string; start_at: string; end_at: string | null;
  reason: string | null; remark: string | null;
};
type RosterRow = { coil_no: string; disposition: string; grade_code: string | null; weight_mt: number | string | null };

function fmt(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true });
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={['h-3 rounded bg-muted animate-pulse', className].filter(Boolean).join(' ')} />;
}

function AnnMhChargeDetailSkeleton() {
  return (
    <div className="grid min-h-0 flex-1 gap-3 overflow-auto lg:grid-cols-2">
      <section className="space-y-3 rounded-lg border border-border bg-background p-4 shadow-sm">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Charge details</h2>
        <div className="grid grid-cols-2 gap-3 text-xs">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="min-w-0">
              <SkeletonLine className="w-10 mb-2" />
              <SkeletonLine className="w-full" />
            </div>
          ))}
        </div>
        <ul className="space-y-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i}>
              <div className="w-full min-h-11 rounded-lg border border-border bg-card px-3 py-2">
                <SkeletonLine className="w-28 mb-2" />
                <SkeletonLine className="w-36" />
              </div>
            </li>
          ))}
        </ul>
        <div className="space-y-2">
          <div className="relative h-10 rounded-full bg-muted">
            <div className="absolute inset-y-0 left-0 rounded-full bg-status-running/20" style={{ width: '40%' }} />
          </div>
          <SkeletonLine className="w-44 mx-auto h-2.5" />
        </div>
      </section>

      <div className="space-y-3">
        <section className="rounded-lg border border-border bg-background p-4 space-y-2 shadow-sm">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Roster</h2>
          <SkeletonLine className="w-28" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card px-3 py-2">
              <SkeletonLine className="w-full" />
            </div>
          ))}
        </section>

        <section className="rounded-lg border border-border bg-background p-4 space-y-2 shadow-sm">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Stoppages</h2>
          <SkeletonLine className="w-20" />
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card px-3 py-2">
              <SkeletonLine className="w-24 mb-2" />
              <SkeletonLine className="w-full" />
            </div>
          ))}
        </section>

        <section className="rounded-lg border border-border bg-background p-4 space-y-2 shadow-sm">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
            <Check className="h-3.5 w-3.5" /> Operator readings
          </h2>
          <SkeletonLine className="w-28" />
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-mono tabular-nums">
              <SkeletonLine className="w-56 mb-2" />
              <SkeletonLine className="w-full" />
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

function SwipeAdvance({ disabled, nextLabel, onAdvance }: { disabled: boolean; nextLabel: string; onAdvance: () => Promise<void> }) {
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
    if (dragX >= maxX.current * 0.72) {
      try { await onAdvance(); } finally { setDragX(0); }
    } else setDragX(0);
  }
  return (
    <div className="space-y-2">
      <div
        ref={trackRef}
        className={['relative h-10 rounded-full bg-muted', disabled ? 'opacity-60' : ''].join(' ')}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-status-running/20"
          style={{
            width: `${dragX + 36}px`,
            transition: dragging ? 'none' : 'width 180ms ease-out',
          }}
        />
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold uppercase text-muted-foreground">Swipe to next stage</p>
        <button
          type="button"
          disabled={disabled}
          className="absolute top-1 left-1 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background touch-none transition-transform"
          style={{
            transform: `translateX(${dragX}px)`,
            transition: dragging ? 'none' : 'transform 180ms ease-out',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={(e) => { if (dragging) setDragX(Math.max(0, Math.min(maxX.current, e.clientX - startX.current))); }}
          onPointerUp={() => void onPointerUp()}
          onPointerCancel={() => { setDragging(false); setDragX(0); }}
          aria-label="Advance stage"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
      <p className="text-center text-[10px] font-bold uppercase text-status-running">Next: {nextLabel}</p>
    </div>
  );
}

/** Full-screen MH charge/base detail. */
export function AnnMhChargeDetailPage() {
  const { chargeNo = '' } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<{
    charge: Record<string, unknown>;
    roster: RosterRow[];
    stages: Stage[];
    readings: Reading[];
    stoppages: Stoppage[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedStage, setSelectedStage] = useState<Stage | null>(null);

  const reload = useCallback(async () => {
    const d = await apiClient.get<typeof detail>(`/stations/ann/charges/${encodeURIComponent(chargeNo)}`);
    setDetail(d);
  }, [chargeNo]);

  useEffect(() => { void reload().catch(() => setDetail(null)); }, [reload]);

  const active = detail?.stages.find((s) => s.start_at && !s.end_at && !s.skipped);
  const nextStage = active ? detail?.stages.find((s) => s.seq === active.seq + 1) : null;
  const nextLabel = active?.stage_code === 'UNLOADING' ? 'Complete unload' : nextStage ? nextStage.stage_code : '—';
  const charge = detail?.charge;

  async function advanceStage() {
    setBusy(true);
    try {
      await apiClient.post('/stations/ann/charges', { action: 'advance-stage', chargeNo });
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const stagesSorted = useMemo(() => [...(detail?.stages ?? [])].sort((a, b) => a.seq - b.seq), [detail]);
  const openStoppage = (detail?.stoppages ?? []).find((s) => !s.end_at);
  const statusLabel =
    charge?.status === 'DONE' ? 'COMPLETE' : openStoppage ? 'STOPPAGE' : String(charge?.status ?? 'RUNNING');
  const statusTone: Tone =
    statusLabel === 'COMPLETE' ? 'info' : statusLabel === 'STOPPAGE' ? 'warning' : statusLabel === 'PENDING' ? 'accent' : 'success';

  return (
    <MachineHeadShell
      title={`Charge ${chargeNo}`}
      subtitle={[
        `Batch ${String(charge?.annealing_batch_no ?? '—')}`,
        `Base ${String(charge?.base_no ?? '—')}`,
        String(charge?.current_stage_code ?? '—'),
      ].join(' · ')}
      fillViewport
      onRefresh={() => void reload()}
      headerActions={
        <div className="flex items-center gap-2">
          <ZBadge tone={statusTone} label={statusLabel} dot={statusLabel === 'RUNNING' || statusLabel === 'ACTIVE'} />
          <ZButton variant="secondary" size="sm" onClick={() => navigate('/machine-head/ann/live')}>
            <ChevronLeft className="h-4 w-4" /> Live
          </ZButton>
        </div>
      }
    >
      {!detail ? (
        <AnnMhChargeDetailSkeleton />
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 overflow-auto lg:grid-cols-2">
          <section className="space-y-3 rounded-lg border border-border bg-background p-4 shadow-sm">
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Charge details</h2>
            <dl className="grid grid-cols-2 gap-3 text-xs">
              {[
                ['Status', String(charge?.status ?? '—')],
                ['Grade', String(charge?.grade_code ?? '—')],
                ['Coils / Wt', `${String(charge?.no_of_coils ?? 0)} · ${Number(charge?.charge_wt_mt ?? 0).toFixed(2)} MT`],
                ['F/C No', charge?.furnace_id != null ? String(charge.furnace_id) : '—'],
                ['Exp unload', fmt(charge?.exp_unloading_time as string | null)],
                ['Unload wt', charge?.unloading_wt_mt != null ? `${Number(charge.unloading_wt_mt).toFixed(2)} MT` : '—'],
                ['Dew N₂', charge?.dew_point_n2 != null ? String(charge.dew_point_n2) : '—'],
                ['Dew H₂', charge?.dew_point_h2 != null ? String(charge.dew_point_h2) : '—'],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
                  <dd className="mt-0.5 font-semibold font-mono tabular-nums text-foreground truncate">{value}</dd>
                </div>
              ))}
            </dl>
            <ul className="space-y-1">
              {stagesSorted.map((s) => {
                const isSelected = selectedStage?.stage_code === s.stage_code;
                return (
                  <li key={s.stage_code}>
                    <button
                      type="button"
                      aria-current={isSelected ? 'true' : undefined}
                      className={[
                        'w-full min-h-11 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs',
                        'cursor-pointer transition-colors hover:bg-muted active:scale-[0.99]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        isSelected ? 'border-status-running/60 bg-status-running/10' : '',
                      ].join(' ')}
                      onClick={() => setSelectedStage(s)}
                    >
                      <span className="font-semibold text-foreground">{s.stage_code}</span>
                      <span className="mt-0.5 block font-mono tabular-nums text-muted-foreground">
                        {fmt(s.start_at)} → {fmt(s.end_at)}{s.skipped ? ' · SKIP' : ''}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {selectedStage && (
              <div className="rounded-lg border border-border bg-card px-3 py-2">
                <p className="text-xs text-muted-foreground font-mono">
                  Selected {selectedStage.stage_code}: {fmt(selectedStage.start_at)} → {fmt(selectedStage.end_at)}
                </p>
              </div>
            )}
            <SwipeAdvance disabled={busy || charge?.status === 'DONE' || !active} nextLabel={nextLabel} onAdvance={advanceStage} />
          </section>

          <div className="space-y-3">
            <section className="rounded-lg border border-border bg-background p-4 space-y-2 shadow-sm">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Roster</h2>
              {detail.roster.map((r) => (
                <div
                  key={r.coil_no}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs"
                >
                  <span className="font-mono tabular-nums text-foreground">
                    {r.coil_no}
                    {r.grade_code ? ` · ${r.grade_code}` : ''}
                    {' · '}
                    {Number(r.weight_mt ?? 0).toFixed(2)} MT
                  </span>
                  {r.disposition === 'HOLD' ? (
                    <ZBadge tone="accent" label="HOLD" />
                  ) : r.disposition === 'REJECT' ? (
                    <ZBadge tone="destructive" label="REJECT" />
                  ) : (
                    <ZBadge tone="success" label={r.disposition || 'ADVANCE'} />
                  )}
                </div>
              ))}
            </section>
            <section className="rounded-lg border border-border bg-background p-4 space-y-2 shadow-sm">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Stoppages</h2>
              {(detail.stoppages ?? []).length === 0 && <p className="text-xs text-muted-foreground">None</p>}
              {(detail.stoppages ?? []).map((s) => (
                <div key={String(s.stoppage_id)} className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">{s.category_code}</span>
                    {!s.end_at && <ZBadge tone="warning" label="OPEN" />}
                  </div>
                  <span className="block font-mono tabular-nums text-muted-foreground mt-0.5">{fmt(s.start_at)} → {fmt(s.end_at)}{s.reason ? ` · ${s.reason}` : ''}</span>
                </div>
              ))}
            </section>
            <section className="rounded-lg border border-border bg-background p-4 space-y-2 shadow-sm">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1">
                <Check className="h-3.5 w-3.5" /> Operator readings
              </h2>
              {(detail.readings ?? []).length === 0 && <p className="text-xs text-muted-foreground">No readings</p>}
              {(detail.readings ?? []).map((r) => (
                <div key={r.reading_id} className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-mono tabular-nums">
                  <p className="font-sans font-medium text-foreground">{fmt(r.taken_at)} · {r.stage_code ?? '—'}</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                    {(
                      [
                        ['C', r.charge_temp],
                        ['G', r.gas_temp],
                        ['F/C', r.fc_temp],
                        ['P', r.base_press],
                        ['Fan', r.base_fan_rpm],
                        ['N2H2', r.n2h2_flow],
                        ['Fuel', r.fuel_flow],
                        ['RCF', r.rcf_rpm],
                      ] as Array<[string, number | string | null]>
                    ).map(([label, value]) => (
                      <div key={label} className="flex items-baseline justify-between gap-3">
                        <span className="font-sans text-muted-foreground uppercase tracking-[0.08em]">{label}</span>
                        <span className="text-foreground">{value ?? '—'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          </div>
        </div>
      )}
    </MachineHeadShell>
  );
}
