import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatPlantTime, plantMinutesOfDay } from '@m1/shared-validation';
import { ZButton } from '../../primitives/ZButton';
import { apiClient } from '../../../lib/apiClient';
import { formatShiftDate } from '../../../lib/dateFormat';
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

// ponytail: must live outside PklChartGrid — nested Field remounts every keystroke and steals focus
function ChartField({
  label,
  value,
  onChange,
  className,
  text,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  className: string;
  text?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        inputMode={text ? 'text' : 'decimal'}
      />
    </label>
  );
}

/** Process Chart — history by default; entry form opens only via Add Reading. */
export function PklChartGrid() {
  const liveShiftLogId = useShiftStore((s) => s.shiftLogId);
  const liveShiftDate = useShiftStore((s) => {
    const raw = s.detectedShift?.prodDate ?? s.shiftDate;
    const day = formatShiftDate(raw);
    return day === '—' ? '' : day;
  });
  const liveShiftCode = useShiftStore((s) =>
    String(s.detectedShift?.shiftCode ?? s.shiftCode).toUpperCase() as 'A' | 'B' | 'C',
  );

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

  // Filter: default follows current running shift; user can pick past date+shift
  const [filterDate, setFilterDate] = useState('');
  const [filterShift, setFilterShift] = useState<'A' | 'B' | 'C' | ''>('');
  const [viewShiftLogId, setViewShiftLogId] = useState<string | null>(null);
  const [followLive, setFollowLive] = useState(true);
  const [filterMsg, setFilterMsg] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const isLiveView = Boolean(liveShiftLogId && viewShiftLogId === liveShiftLogId);

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

  const loadHistory = useCallback(async (logId: string | null) => {
    if (!logId) {
      setHistory([]);
      return;
    }
    try {
      const data = await apiClient.get<{ rows: ChartDbRow[] }>(`/stations/pkl/chart/${encodeURIComponent(logId)}`);
      setHistory(data.rows ?? []);
    } catch { setHistory([]); }
  }, []);

  const resolveShiftLog = useCallback(async (date: string, code: string) => {
    if (!date || !code) {
      setViewShiftLogId(null);
      setHistory([]);
      setFilterMsg('Pick a date and shift');
      return;
    }
    // Current running shift — use live id directly
    if (liveShiftLogId && date === liveShiftDate && code === liveShiftCode) {
      setViewShiftLogId(liveShiftLogId);
      setFollowLive(true);
      setFilterMsg(null);
      await loadHistory(liveShiftLogId);
      return;
    }
    setResolving(true);
    setFilterMsg(null);
    try {
      const qs = new URLSearchParams({ line: 'PKL', shiftDate: date, shiftCode: code });
      const rows = await apiClient.get<Array<{ id: string; processLine?: string; state?: string }>>(
        `/shift-logs?${qs.toString()}`,
      );
      const pkl = rows.find((r) => String(r.processLine ?? '').toUpperCase() === 'PKL') ?? rows[0];
      if (!pkl?.id) {
        setViewShiftLogId(null);
        setHistory([]);
        setFilterMsg(`No PKL shift log for ${date} · Shift ${code}`);
        return;
      }
      setViewShiftLogId(pkl.id);
      setFollowLive(false);
      await loadHistory(pkl.id);
    } catch (e) {
      setViewShiftLogId(null);
      setHistory([]);
      setFilterMsg(e instanceof Error ? e.message : 'Failed to load shift');
    } finally {
      setResolving(false);
    }
  }, [liveShiftLogId, liveShiftDate, liveShiftCode, loadHistory]);

  // Default filter = current running shift
  useEffect(() => {
    if (!followLive) return;
    if (liveShiftDate) setFilterDate(liveShiftDate);
    if (liveShiftCode) setFilterShift(liveShiftCode);
    if (liveShiftLogId) {
      setViewShiftLogId(liveShiftLogId);
      void loadHistory(liveShiftLogId);
    } else {
      setViewShiftLogId(null);
      setHistory([]);
    }
  }, [followLive, liveShiftLogId, liveShiftDate, liveShiftCode, loadHistory]);

  useEffect(() => { void loadMeta(); }, [loadMeta]);

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
    if (!isLiveView) return;
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
    if (!liveShiftLogId || !isLiveView) return;
    setSaving(true);
    setMsg(null);
    const payload = {
      shiftLogId: liveShiftLogId,
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
      await loadHistory(liveShiftLogId);
      closeForm();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const fieldCls = (val: string, key: string, scope: string) =>
    `w-full min-h-11 rounded-lg border border-input bg-background px-3 text-base font-mono tabular-nums ${cellClass(val, key, scope)}`;

  const filterSelectCls =
    'h-10 rounded-lg border border-input bg-background px-3 text-sm font-mono';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-secondary">
      <div className="shrink-0 flex items-center justify-between gap-3 px-4 py-3 bg-primary text-white h-14">
        <div className="flex items-center gap-3 min-w-0">
          <p className="text-base font-bold shrink-0">Process Chart</p>
          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-white/15">PKL</span>
          {duePrompt && isLiveView && <span className="text-xs opacity-90">Reading due · every {intervalHours}h</span>}
        </div>
        <ZButton
          type="button"
          variant="secondary"
          className="shrink-0 bg-white text-primary hover:bg-white/90"
          onClick={openForm}
          disabled={!isLiveView}
          title={isLiveView ? undefined : 'Switch to current shift to add a reading'}
        >
          Add Reading
        </ZButton>
      </div>

      <div className="shrink-0 flex flex-wrap items-end gap-3 px-4 py-3 border-b border-border bg-card">
        <label className="block space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Date</span>
          <input
            type="date"
            className={filterSelectCls}
            value={filterDate}
            onChange={(e) => {
              const next = e.target.value;
              setFilterDate(next);
              setFollowLive(false);
              if (next && filterShift) void resolveShiftLog(next, filterShift);
            }}
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Shift</span>
          <select
            className={filterSelectCls}
            value={filterShift}
            onChange={(e) => {
              const next = e.target.value as 'A' | 'B' | 'C' | '';
              setFilterShift(next);
              setFollowLive(false);
              if (filterDate && next) void resolveShiftLog(filterDate, next);
            }}
          >
            <option value="" disabled>Select…</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </label>
        <ZButton
          type="button"
          variant="secondary"
          disabled={followLive && isLiveView}
          onClick={() => {
            setFollowLive(true);
            setFilterMsg(null);
            if (liveShiftDate) setFilterDate(liveShiftDate);
            if (liveShiftCode) setFilterShift(liveShiftCode);
            if (liveShiftLogId) {
              setViewShiftLogId(liveShiftLogId);
              void loadHistory(liveShiftLogId);
            }
          }}
        >
          Current shift
        </ZButton>
        <div className="min-w-0 pb-1 text-xs text-muted-foreground">
          {resolving ? (
            <span>Loading…</span>
          ) : isLiveView ? (
            <span className="text-success font-medium">
              Current · {filterDate || '—'} · Shift {filterShift || '—'}
            </span>
          ) : viewShiftLogId ? (
            <span>
              Past · {filterDate || '—'} · Shift {filterShift || '—'} (read only)
            </span>
          ) : (
            <span>{filterMsg ?? 'No shift selected'}</span>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
        {duePrompt && isLiveView && (
          <p className="text-sm bg-info/10 border border-info/30 text-info rounded-lg px-3 py-2">
            Reading due ({labels.join(' / ')}, every {intervalHours}h) — soft reminder.
          </p>
        )}
        {filterMsg && !isLiveView && (
          <p className="text-sm bg-warning/10 border border-warning/30 text-warning rounded-lg px-3 py-2">
            {filterMsg}
          </p>
        )}

        {formOpen && isLiveView && (
          <div className="fixed inset-0 z-[140] flex items-center justify-center p-4">
            <button
              type="button"
              aria-label="Close reading form"
              className="fixed inset-0 bg-primary/50"
              onClick={() => { if (!saving) closeForm(); }}
            />
            <section className="relative z-10 w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
              <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">New reading</h2>
                <ZButton type="button" variant="secondary" onClick={closeForm} disabled={saving}>Cancel</ZButton>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="block space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Chart time</span>
                    <p className="w-full min-h-11 flex items-center rounded-lg border border-border bg-muted/40 px-3 text-base font-mono tabular-nums text-foreground">
                      {chartTime}
                    </p>
                  </div>
                  <ChartField
                    label="Line incharge"
                    value={line.lineIncharge}
                    className={fieldCls(line.lineIncharge, '', 'LINE')}
                    onChange={(v) => setLine((prev) => ({ ...prev, lineIncharge: v }))}
                    text
                  />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  {([1, 2, 3] as const).map((n) => (
                    <div key={n} className="rounded-lg border border-border bg-secondary/40 p-3 space-y-3">
                      <p className="text-sm font-bold text-foreground">Tank T{n}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <ChartField label="Level mm" value={tanks[n].level} className={fieldCls(tanks[n].level, 'tank_level', `T${n}`)} onChange={(v) => setTanks((prev) => ({ ...prev, [n]: { ...prev[n], level: v } }))} />
                        <ChartField label="Temp °C" value={tanks[n].temp} className={fieldCls(tanks[n].temp, 'tank_temp', `T${n}`)} onChange={(v) => setTanks((prev) => ({ ...prev, [n]: { ...prev[n], temp: v } }))} />
                        <ChartField label="Acid %" value={tanks[n].acid} className={fieldCls(tanks[n].acid, 'acid_strength', `T${n}`)} onChange={(v) => setTanks((prev) => ({ ...prev, [n]: { ...prev[n], acid: v } }))} />
                        <ChartField label="Iron %" value={tanks[n].iron} className={fieldCls(tanks[n].iron, 'iron_strength', `T${n}`)} onChange={(v) => setTanks((prev) => ({ ...prev, [n]: { ...prev[n], iron: v } }))} />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-3">
                  <p className="text-sm font-bold text-foreground">Steam / burner</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <ChartField label="Inlet PRV" value={line.steamInlet} className={fieldCls(line.steamInlet, 'steam_inlet', 'LINE')} onChange={(v) => setLine((prev) => ({ ...prev, steamInlet: v }))} />
                    <ChartField label="Out PRV" value={line.steamOutlet} className={fieldCls(line.steamOutlet, 'steam_outlet', 'LINE')} onChange={(v) => setLine((prev) => ({ ...prev, steamOutlet: v }))} />
                    <ChartField label="Masha" value={line.masha} className={fieldCls(line.masha, 'burner_pressure', 'LINE')} onChange={(v) => setLine((prev) => ({ ...prev, masha: v }))} />
                    <ChartField label="Hot air °C" value={line.hotAir} className={fieldCls(line.hotAir, 'hot_air_temp', 'LINE')} onChange={(v) => setLine((prev) => ({ ...prev, hotAir: v }))} />
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-3">
                  <p className="text-sm font-bold text-foreground">Dosage L/min</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <ChartField label="Acid" value={line.dosageAcid} className={fieldCls(line.dosageAcid, '', 'LINE')} onChange={(v) => setLine((prev) => ({ ...prev, dosageAcid: v }))} />
                    <ChartField label="Water" value={line.dosageWater} className={fieldCls(line.dosageWater, '', 'LINE')} onChange={(v) => setLine((prev) => ({ ...prev, dosageWater: v }))} />
                    <ChartField label="Inhibitor" value={line.dosageInhib} className={fieldCls(line.dosageInhib, '', 'LINE')} onChange={(v) => setLine((prev) => ({ ...prev, dosageInhib: v }))} />
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-3">
                  <p className="text-sm font-bold text-foreground">Hot rinse</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <ChartField label="Cl" value={line.rinseCl} className={fieldCls(line.rinseCl, 'rinse_cl', 'RINSE')} onChange={(v) => setLine((prev) => ({ ...prev, rinseCl: v }))} />
                    <ChartField label="pH" value={line.rinsePh} className={fieldCls(line.rinsePh, 'rinse_ph', 'RINSE')} onChange={(v) => setLine((prev) => ({ ...prev, rinsePh: v }))} />
                    <ChartField label="Flow" value={line.rinseFlow} className={fieldCls(line.rinseFlow, 'rinse_flow', 'RINSE')} onChange={(v) => setLine((prev) => ({ ...prev, rinseFlow: v }))} />
                    <ChartField label="Temp °C" value={line.rinseTemp} className={fieldCls(line.rinseTemp, 'rinse_temp', 'RINSE')} onChange={(v) => setLine((prev) => ({ ...prev, rinseTemp: v }))} />
                  </div>
                  <p className="text-[10px] text-muted-foreground">Rinse acid % / iron % are entered once at end of shift.</p>
                </div>
              </div>

              <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border bg-card">
                <div className="min-w-0 space-y-1">
                  <p className="text-xs text-muted-foreground">Out-of-spec cells amber — still saves. Specs advisory only.</p>
                  {msg && <p className="text-sm">{msg}</p>}
                </div>
                <ZButton
                  type="button"
                  variant="primary"
                  size="lg"
                  className="min-w-[16rem] px-12 font-bold ml-auto"
                  onClick={() => void saveChart()}
                  disabled={saving || !liveShiftLogId}
                >
                  {saving ? 'Saving…' : 'Save Reading'}
                </ZButton>
              </div>
            </section>
          </div>
        )}

        <section className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="sticky top-0 z-10 px-4 py-3 border-b border-border bg-card flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-foreground">
                {isLiveView ? 'Shift readings' : 'Past shift readings'}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {!viewShiftLogId
                  ? 'Select date and shift'
                  : stacked.length === 0
                    ? 'No readings yet'
                    : `${stacked.length} reading${stacked.length === 1 ? '' : 's'} · ${filterDate || '—'} · Shift ${filterShift || '—'}`}
              </p>
            </div>
            <p className="text-xs text-muted-foreground hidden sm:block">
              {isLiveView ? 'Use Add Reading to log the next interval.' : 'Read only — switch to Current shift to add.'}
            </p>
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
