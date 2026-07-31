import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, ChevronLeft, ChevronsRight } from 'lucide-react';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../../components/primitives/ZButton';
import { apiClient } from '../../../lib/apiClient';

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
      <div ref={trackRef} className={['relative h-10 rounded-full bg-muted', disabled ? 'opacity-50' : ''].join(' ')}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-status-running/20" style={{ width: `${dragX + 36}px` }} />
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold uppercase text-muted-foreground">Swipe to next stage</p>
        <button type="button" disabled={disabled} className="absolute top-1 left-1 flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background touch-none" style={{ transform: `translateX(${dragX}px)` }}
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
        <ZButton variant="secondary" size="sm" onClick={() => navigate('/machine-head/ann/live')}>
          <ChevronLeft className="h-4 w-4" /> Live
        </ZButton>
      }
    >
      {!detail ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid min-h-0 flex-1 gap-3 overflow-auto lg:grid-cols-2">
          <section className="space-y-3 rounded-xl border border-border bg-background p-4">
            <h2 className="text-sm font-bold">Charge details</h2>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-muted-foreground">Status</dt><dd className="font-semibold">{String(charge?.status ?? '—')}</dd></div>
              <div><dt className="text-muted-foreground">Grade</dt><dd className="font-semibold">{String(charge?.grade_code ?? '—')}</dd></div>
              <div><dt className="text-muted-foreground">Coils / Wt</dt><dd className="font-semibold">{String(charge?.no_of_coils ?? 0)} · {Number(charge?.charge_wt_mt ?? 0).toFixed(2)} MT</dd></div>
              <div><dt className="text-muted-foreground">F/C No</dt><dd className="font-semibold">{charge?.furnace_id != null ? String(charge.furnace_id) : '—'}</dd></div>
              <div><dt className="text-muted-foreground">Exp unload</dt><dd className="font-semibold">{fmt(charge?.exp_unloading_time as string | null)}</dd></div>
              <div><dt className="text-muted-foreground">Unload wt</dt><dd className="font-semibold">{charge?.unloading_wt_mt != null ? `${Number(charge.unloading_wt_mt).toFixed(2)} MT` : '—'}</dd></div>
              <div><dt className="text-muted-foreground">Dew N₂</dt><dd className="font-semibold">{charge?.dew_point_n2 != null ? String(charge.dew_point_n2) : '—'}</dd></div>
              <div><dt className="text-muted-foreground">Dew H₂</dt><dd className="font-semibold">{charge?.dew_point_h2 != null ? String(charge.dew_point_h2) : '—'}</dd></div>
            </dl>
            <ul className="space-y-1">
              {stagesSorted.map((s) => (
                <li key={s.stage_code}>
                  <button type="button" className="w-full rounded-lg border border-border bg-card px-3 py-2 text-left text-xs hover:bg-muted" onClick={() => setSelectedStage(s)}>
                    <span className="font-semibold">{s.stage_code}</span>
                    <span className="mt-0.5 block text-muted-foreground">
                      {fmt(s.start_at)} → {fmt(s.end_at)}{s.skipped ? ' · SKIP' : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {selectedStage && (
              <p className="text-xs text-muted-foreground">
                Selected {selectedStage.stage_code}: {fmt(selectedStage.start_at)} → {fmt(selectedStage.end_at)}
              </p>
            )}
            <SwipeAdvance disabled={busy || charge?.status === 'DONE' || !active} nextLabel={nextLabel} onAdvance={advanceStage} />
          </section>

          <div className="space-y-3">
            <section className="rounded-xl border border-border bg-background p-4 space-y-2">
              <h2 className="text-sm font-bold">Roster</h2>
              {detail.roster.map((r) => (
                <div key={r.coil_no} className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-mono">
                  {r.coil_no} · {r.grade_code ?? ''} · {Number(r.weight_mt ?? 0).toFixed(2)} MT · {r.disposition}
                </div>
              ))}
            </section>
            <section className="rounded-xl border border-border bg-background p-4 space-y-2">
              <h2 className="text-sm font-bold">Stoppages</h2>
              {(detail.stoppages ?? []).length === 0 && <p className="text-xs text-muted-foreground">None</p>}
              {(detail.stoppages ?? []).map((s) => (
                <div key={String(s.stoppage_id)} className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
                  <span className="font-semibold">{s.category_code}{!s.end_at ? ' · OPEN' : ''}</span>
                  <span className="block text-muted-foreground">{fmt(s.start_at)} → {fmt(s.end_at)}{s.reason ? ` · ${s.reason}` : ''}</span>
                </div>
              ))}
            </section>
            <section className="rounded-xl border border-border bg-background p-4 space-y-2">
              <h2 className="text-sm font-bold flex items-center gap-1"><Check className="h-3.5 w-3.5" /> Operator readings</h2>
              {(detail.readings ?? []).length === 0 && <p className="text-xs text-muted-foreground">No readings</p>}
              {(detail.readings ?? []).map((r) => (
                <div key={r.reading_id} className="rounded-lg border border-border bg-card px-3 py-2 text-xs font-mono">
                  <p className="font-sans font-medium">{fmt(r.taken_at)} · {r.stage_code ?? '—'}</p>
                  <p className="text-muted-foreground">
                    C {r.charge_temp ?? '—'} · G {r.gas_temp ?? '—'} · F/C {r.fc_temp ?? '—'} · P {r.base_press ?? '—'} · Fan {r.base_fan_rpm ?? '—'}
                    {' · '}N2H2 {r.n2h2_flow ?? '—'} · Fuel {r.fuel_flow ?? '—'} · RCF {r.rcf_rpm ?? '—'}
                  </p>
                </div>
              ))}
            </section>
          </div>
        </div>
      )}
    </MachineHeadShell>
  );
}
