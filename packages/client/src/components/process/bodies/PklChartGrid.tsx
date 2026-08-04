import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatPlantTime, plantMinutesOfDay } from '@m1/shared-validation';
import { ZButton } from '../../primitives/ZButton';
import { apiClient } from '../../../lib/apiClient';
import { useShiftStore } from '../../../store/shiftStore';

type SpecLimit = {
  param_key: string;
  tank_scope: string;
  min_val: number | string | null;
  max_val: number | string | null;
  unit: string | null;
};

type ChartDbRow = {
  chart_time: string;
  tank_no: number | null;
  tank_level: number | string | null;
  tank_temp_degc: number | string | null;
  acid_strength_pct: number | string | null;
  iron_strength_pct: number | string | null;
  steam_inlet_kgcm2?: number | string | null;
  steam_outlet_kgcm2?: number | string | null;
  burner_pressure_kgcm2?: number | string | null;
  hot_air_temp_degc?: number | string | null;
  dosage_acid?: number | string | null;
  dosage_water?: number | string | null;
  dosage_inhibitor?: number | string | null;
  rinse_cl?: number | string | null;
  rinse_ph?: number | string | null;
  rinse_flow?: number | string | null;
  rinse_temp_degc?: number | string | null;
  line_incharge?: string | null;
};

type TankVals = { level: string; temp: string; acid: string; iron: string };
type LineVals = {
  steamInlet: string; steamOutlet: string; masha: string; hotAir: string;
  dosageAcid: string; dosageWater: string; dosageInhib: string;
  rinseCl: string; rinsePh: string; rinseFlow: string; rinseTemp: string;
  lineIncharge: string;
};

const emptyTank = (): TankVals => ({ level: '', temp: '', acid: '', iron: '' });
const emptyLine = (): LineVals => ({
  steamInlet: '', steamOutlet: '', masha: '', hotAir: '',
  dosageAcid: '', dosageWater: '', dosageInhib: '',
  rinseCl: '', rinsePh: '', rinseFlow: '', rinseTemp: '',
  lineIncharge: '',
});

function outOfRange(val: string, min: number | null, max: number | null): boolean {
  if (val === '') return false;
  const n = Number(val);
  if (!Number.isFinite(n)) return false;
  if (min != null && n < min) return true;
  if (max != null && n > max) return true;
  return false;
}

function lim(limits: SpecLimit[], key: string, scope: string) {
  const row = limits.find((l) => l.param_key === key && l.tank_scope === scope);
  return {
    min: row?.min_val != null ? Number(row.min_val) : null,
    max: row?.max_val != null ? Number(row.max_val) : null,
  };
}

function s(v: unknown) { return v == null || v === '' ? '' : String(v); }

/** Process Chart — history by default; entry form opens only via Add Reading. */
export function PklChartGrid() {
  const { shiftLogId } = useShiftStore();
  const [chartTime, setChartTime] = useState(formatPlantTime());
  const [labels, setLabels] = useState(['1st', '3rd', '5th', '7th']);
  const [intervalHours, setIntervalHours] = useState(2);
  const [duePrompt, setDuePrompt] = useState(false);
  const [limits, setLimits] = useState<SpecLimit[]>([]);
  const [history, setHistory] = useState<ChartDbRow[]>([]);
  const [tanks, setTanks] = useState<Record<1 | 2 | 3, TankVals>>({ 1: emptyTank(), 2: emptyTank(), 3: emptyTank() });
  const [line, setLine] = useState<LineVals>(emptyLine());
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const loadMeta = useCallback(async () => {
    try {
      const [cfg, lims] = await Promise.all([
        apiClient.get<{ config: { interval_hours?: number; reading_labels?: string[] } | null }>('/stations/pkl/chart-config'),
        apiClient.get<{ limits: SpecLimit[] }>('/stations/pkl/spec-limits'),
      ]);
      if (cfg.config?.interval_hours) setIntervalHours(Number(cfg.config.interval_hours));
      if (Array.isArray(cfg.config?.reading_labels)) setLabels(cfg.config.reading_labels.map(String));
      setLimits(lims.limits ?? []);
    } catch { /* soft */ }
  }, []);

  const loadHistory = useCallback(async () => {
    if (!shiftLogId) return;
    try {
      const data = await apiClient.get<{ rows: ChartDbRow[] }>(`/stations/pkl/chart/${encodeURIComponent(shiftLogId)}`);
      setHistory(data.rows ?? []);
    } catch { setHistory([]); }
  }, [shiftLogId]);

  useEffect(() => { void loadMeta(); }, [loadMeta]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  useEffect(() => {
    const tick = () => {
      const mins = plantMinutesOfDay();
      const step = Math.max(1, intervalHours) * 60;
      setDuePrompt(mins % step < 15 || mins % step > step - 15);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [intervalHours]);

  const stacked = useMemo(() => {
    const byTime = new Map<string, { tanks: Record<number, ChartDbRow>; line?: ChartDbRow }>();
    for (const r of history) {
      const t = String(r.chart_time);
      if (!byTime.has(t)) byTime.set(t, { tanks: {} });
      const bucket = byTime.get(t)!;
      const tn = Number(r.tank_no ?? 0);
      if (tn >= 1 && tn <= 3) bucket.tanks[tn] = r;
      if (tn === 1) bucket.line = r;
    }
    return [...byTime.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [history]);

  function cellClass(val: string, key: string, scope: string) {
    if (!key) return '';
    const { min, max } = lim(limits, key, scope);
    return outOfRange(val, min, max) ? 'border-amber-400 bg-amber-50' : '';
  }

  function num(v: string) { return v === '' ? undefined : Number(v); }

  function openForm() {
    setMsg(null);
    setTanks({ 1: emptyTank(), 2: emptyTank(), 3: emptyTank() });
    setLine(emptyLine());
    setChartTime(formatPlantTime());
    setFormOpen(true);
  }

  function closeForm() {
    setFormOpen(false);
    setMsg(null);
    setTanks({ 1: emptyTank(), 2: emptyTank(), 3: emptyTank() });
    setLine(emptyLine());
  }

  async function saveChart() {
    if (!shiftLogId) return;
    setSaving(true);
    setMsg(null);
    const payload = {
      shiftLogId,
      chartTime,
      tanks: ([1, 2, 3] as const).map((n) => ({
        tankNo: n,
        tankLevel: num(tanks[n].level),
        tankTempDegc: num(tanks[n].temp),
        acidStrengthPct: num(tanks[n].acid),
        ironStrengthPct: num(tanks[n].iron),
      })),
      line: {
        steamInletKgcm2: num(line.steamInlet),
        steamOutletKgcm2: num(line.steamOutlet),
        burnerPressureKgcm2: num(line.masha),
        hotAirTempDegc: num(line.hotAir),
        dosageAcid: num(line.dosageAcid),
        dosageWater: num(line.dosageWater),
        dosageInhibitor: num(line.dosageInhib),
        rinseCl: num(line.rinseCl),
        rinsePh: num(line.rinsePh),
        rinseFlow: num(line.rinseFlow),
        rinseTempDegc: num(line.rinseTemp),
        lineIncharge: line.lineIncharge || undefined,
      },
    };
    try {
      await apiClient.post('/stations/pkl/chart', payload);
      setMsg('Saved');
      await loadHistory();
      closeForm();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const fieldCls = (val: string, key: string, scope: string) =>
    `w-full min-h-11 rounded-lg border border-input bg-background px-3 text-base font-mono tabular-nums ${cellClass(val, key, scope)}`;

  function Field({
    label, value, onChange, paramKey, scope, text,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    paramKey?: string;
    scope?: string;
    text?: boolean;
  }) {
    return (
      <label className="block space-y-1">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
        <input
          className={fieldCls(value, paramKey ?? '', scope ?? 'LINE')}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode={text ? 'text' : 'decimal'}
        />
      </label>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-secondary">
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-primary text-white h-14">
        <div className="flex items-center gap-3 min-w-0">
          <p className="text-base font-bold shrink-0">Process Chart</p>
          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-white/15">PKL</span>
          {duePrompt && <span className="text-xs opacity-90">Reading due · every {intervalHours}h</span>}
        </div>
        {!formOpen && (
          <ZButton
            type="button"
            variant="secondary"
            className="shrink-0 bg-white text-primary hover:bg-white/90"
            onClick={openForm}
            disabled={!shiftLogId}
          >
            Add Reading
          </ZButton>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
        {duePrompt && (
          <p className="text-sm bg-info/10 border border-info/30 text-info rounded-lg px-3 py-2">
            Reading due ({labels.join(' / ')}, every {intervalHours}h) — soft reminder.
          </p>
        )}

        {formOpen && (
          <section className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">New reading</h2>
              <ZButton type="button" variant="secondary" onClick={closeForm} disabled={saving}>Cancel</ZButton>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Chart time" value={chartTime} onChange={setChartTime} text />
              <Field
                label="Line incharge"
                value={line.lineIncharge}
                onChange={(v) => setLine({ ...line, lineIncharge: v })}
                text
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              {([1, 2, 3] as const).map((n) => (
                <div key={n} className="rounded-lg border border-border bg-secondary/40 p-3 space-y-3">
                  <p className="text-sm font-bold text-foreground">Tank T{n}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Level mm" value={tanks[n].level} paramKey="tank_level" scope={`T${n}`} onChange={(v) => setTanks({ ...tanks, [n]: { ...tanks[n], level: v } })} />
                    <Field label="Temp °C" value={tanks[n].temp} paramKey="tank_temp" scope={`T${n}`} onChange={(v) => setTanks({ ...tanks, [n]: { ...tanks[n], temp: v } })} />
                    <Field label="Acid %" value={tanks[n].acid} paramKey="acid_strength" scope={`T${n}`} onChange={(v) => setTanks({ ...tanks, [n]: { ...tanks[n], acid: v } })} />
                    <Field label="Iron %" value={tanks[n].iron} paramKey="iron_strength" scope={`T${n}`} onChange={(v) => setTanks({ ...tanks, [n]: { ...tanks[n], iron: v } })} />
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-3">
              <p className="text-sm font-bold text-foreground">Steam / burner</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Field label="Inlet PRV" value={line.steamInlet} paramKey="steam_inlet" scope="LINE" onChange={(v) => setLine({ ...line, steamInlet: v })} />
                <Field label="Out PRV" value={line.steamOutlet} paramKey="steam_outlet" scope="LINE" onChange={(v) => setLine({ ...line, steamOutlet: v })} />
                <Field label="Masha" value={line.masha} paramKey="burner_pressure" scope="LINE" onChange={(v) => setLine({ ...line, masha: v })} />
                <Field label="Hot air °C" value={line.hotAir} paramKey="hot_air_temp" scope="LINE" onChange={(v) => setLine({ ...line, hotAir: v })} />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-3">
              <p className="text-sm font-bold text-foreground">Dosage L/min</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Field label="Acid" value={line.dosageAcid} onChange={(v) => setLine({ ...line, dosageAcid: v })} />
                <Field label="Water" value={line.dosageWater} onChange={(v) => setLine({ ...line, dosageWater: v })} />
                <Field label="Inhibitor" value={line.dosageInhib} onChange={(v) => setLine({ ...line, dosageInhib: v })} />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-3">
              <p className="text-sm font-bold text-foreground">Hot rinse</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Field label="Cl" value={line.rinseCl} paramKey="rinse_cl" scope="RINSE" onChange={(v) => setLine({ ...line, rinseCl: v })} />
                <Field label="pH" value={line.rinsePh} paramKey="rinse_ph" scope="RINSE" onChange={(v) => setLine({ ...line, rinsePh: v })} />
                <Field label="Flow" value={line.rinseFlow} paramKey="rinse_flow" scope="RINSE" onChange={(v) => setLine({ ...line, rinseFlow: v })} />
                <Field label="Temp °C" value={line.rinseTemp} paramKey="rinse_temp" scope="RINSE" onChange={(v) => setLine({ ...line, rinseTemp: v })} />
              </div>
              <p className="text-[10px] text-muted-foreground">Rinse acid % / iron % are entered once at end of shift.</p>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <ZButton type="button" onClick={() => void saveChart()} disabled={saving || !shiftLogId}>
                {saving ? 'Saving…' : 'Save Reading'}
              </ZButton>
              <p className="text-xs text-muted-foreground">Out-of-spec cells amber — still saves. Specs advisory only.</p>
              {msg && <p className="text-sm">{msg}</p>}
            </div>
          </section>
        )}

        <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="sticky top-0 z-10 px-4 py-3 border-b border-border bg-card flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-foreground">Shift readings</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {stacked.length === 0
                  ? 'No readings yet'
                  : `${stacked.length} reading${stacked.length === 1 ? '' : 's'} this shift`}
              </p>
            </div>
            {!formOpen && (
              <p className="text-xs text-muted-foreground hidden sm:block">Use Add Reading to log the next interval.</p>
            )}
          </div>
          {stacked.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground text-center">No readings logged this shift yet.</p>
          ) : (
            <div className="p-4 space-y-4">
              {[...stacked].reverse().map(([time, bucket]) => {
                const L = bucket.line;
                return (
                  <article key={time} className="rounded-xl border border-border bg-secondary/30 overflow-hidden">
                    <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-secondary/60 border-b border-border">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Reading time</p>
                        <p className="font-mono text-lg font-bold text-foreground tabular-nums">{time}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Line incharge</p>
                        <p className="text-sm font-semibold text-foreground">{s(L?.line_incharge) || '—'}</p>
                      </div>
                    </header>

                    <div className="p-4 space-y-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Tanks</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          {([1, 2, 3] as const).map((n) => {
                            const t = bucket.tanks[n];
                            return (
                              <div key={n} className="rounded-lg border border-border bg-card p-3">
                                <p className="text-xs font-bold text-foreground mb-2">Tank T{n}</p>
                                <dl className="grid grid-cols-2 gap-2 text-sm">
                                  <div>
                                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Level mm</dt>
                                    <dd className="font-mono font-semibold tabular-nums">{s(t?.tank_level) || '—'}</dd>
                                  </div>
                                  <div>
                                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Temp °C</dt>
                                    <dd className="font-mono font-semibold tabular-nums">{s(t?.tank_temp_degc) || '—'}</dd>
                                  </div>
                                  <div>
                                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Acid %</dt>
                                    <dd className="font-mono font-semibold tabular-nums">{s(t?.acid_strength_pct) || '—'}</dd>
                                  </div>
                                  <div>
                                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Iron %</dt>
                                    <dd className="font-mono font-semibold tabular-nums">{s(t?.iron_strength_pct) || '—'}</dd>
                                  </div>
                                </dl>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                        <div className="rounded-lg border border-border bg-card p-3">
                          <p className="text-xs font-bold text-foreground mb-2">Steam / burner</p>
                          <dl className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Inlet PRV</dt>
                              <dd className="font-mono font-semibold tabular-nums">{s(L?.steam_inlet_kgcm2) || '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Out PRV</dt>
                              <dd className="font-mono font-semibold tabular-nums">{s(L?.steam_outlet_kgcm2) || '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Masha</dt>
                              <dd className="font-mono font-semibold tabular-nums">{s(L?.burner_pressure_kgcm2) || '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Hot air °C</dt>
                              <dd className="font-mono font-semibold tabular-nums">{s(L?.hot_air_temp_degc) || '—'}</dd>
                            </div>
                          </dl>
                        </div>

                        <div className="rounded-lg border border-border bg-card p-3">
                          <p className="text-xs font-bold text-foreground mb-2">Dosage L/min</p>
                          <dl className="grid grid-cols-3 gap-2 text-sm">
                            <div>
                              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Acid</dt>
                              <dd className="font-mono font-semibold tabular-nums">{s(L?.dosage_acid) || '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Water</dt>
                              <dd className="font-mono font-semibold tabular-nums">{s(L?.dosage_water) || '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Inhib</dt>
                              <dd className="font-mono font-semibold tabular-nums">{s(L?.dosage_inhibitor) || '—'}</dd>
                            </div>
                          </dl>
                        </div>

                        <div className="rounded-lg border border-border bg-card p-3">
                          <p className="text-xs font-bold text-foreground mb-2">Hot rinse</p>
                          <dl className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Cl</dt>
                              <dd className="font-mono font-semibold tabular-nums">{s(L?.rinse_cl) || '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">pH</dt>
                              <dd className="font-mono font-semibold tabular-nums">{s(L?.rinse_ph) || '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Flow</dt>
                              <dd className="font-mono font-semibold tabular-nums">{s(L?.rinse_flow) || '—'}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">Temp °C</dt>
                              <dd className="font-mono font-semibold tabular-nums">{s(L?.rinse_temp_degc) || '—'}</dd>
                            </div>
                          </dl>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
