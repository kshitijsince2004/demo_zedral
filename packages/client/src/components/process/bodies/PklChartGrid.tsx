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
  steam_outlet_burner_kgcm2?: number | string | null;
  burner_pressure_kgcm2?: number | string | null;
  hot_air_temp_degc?: number | string | null;
  dosage_acid?: number | string | null;
  dosage_water?: number | string | null;
  dosage_inhibitor?: number | string | null;
  rinse_cl?: number | string | null;
  rinse_ph?: number | string | null;
  rinse_flow?: number | string | null;
  rinse_temp_degc?: number | string | null;
  rinse_acid_pct?: number | string | null;
  rinse_iron_pct?: number | string | null;
  line_incharge?: string | null;
};

type TankVals = { level: string; temp: string; acid: string; iron: string };
type LineVals = {
  steamInlet: string; steamOutlet: string; steamBurner: string; masha: string; hotAir: string;
  dosageAcid: string; dosageWater: string; dosageInhib: string;
  rinseCl: string; rinsePh: string; rinseFlow: string; rinseTemp: string;
  rinseAcid: string; rinseIron: string; lineIncharge: string;
};

const emptyTank = (): TankVals => ({ level: '', temp: '', acid: '', iron: '' });
const emptyLine = (): LineVals => ({
  steamInlet: '', steamOutlet: '', steamBurner: '', masha: '', hotAir: '',
  dosageAcid: '', dosageWater: '', dosageInhib: '',
  rinseCl: '', rinsePh: '', rinseFlow: '', rinseTemp: '',
  rinseAcid: '', rinseIron: '', lineIncharge: '',
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

/** Log-sheet Process Chart — rows = reading times; columns grouped like the paper (revamp §8). */
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
    const { min, max } = lim(limits, key, scope);
    return outOfRange(val, min, max) ? 'border-amber-400 bg-amber-50' : '';
  }

  function num(v: string) { return v === '' ? undefined : Number(v); }

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
        steamOutletBurnerKgcm2: num(line.steamBurner),
        burnerPressureKgcm2: num(line.masha),
        hotAirTempDegc: num(line.hotAir),
        dosageAcid: num(line.dosageAcid),
        dosageWater: num(line.dosageWater),
        dosageInhibitor: num(line.dosageInhib),
        rinseCl: num(line.rinseCl),
        rinsePh: num(line.rinsePh),
        rinseFlow: num(line.rinseFlow),
        rinseTempDegc: num(line.rinseTemp),
        rinseAcidPct: num(line.rinseAcid),
        rinseIronPct: num(line.rinseIron),
        lineIncharge: line.lineIncharge || undefined,
      },
    };
    try {
      await apiClient.post('/stations/pkl/chart', payload);
      setMsg('Saved');
      setTanks({ 1: emptyTank(), 2: emptyTank(), 3: emptyTank() });
      setLine(emptyLine());
      setChartTime(formatPlantTime());
      await loadHistory();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = 'w-16 min-h-10 rounded border border-input bg-background px-1.5 text-xs font-mono text-center';

  return (
    <div className="flex flex-col h-full overflow-hidden bg-secondary">
      <div className="shrink-0 flex items-center justify-between px-4 py-3 bg-primary text-white h-14">
        <div className="flex items-center gap-3 min-w-0">
          <p className="text-base font-bold shrink-0">Process Chart</p>
          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-white/15">PKL</span>
          {duePrompt && <span className="text-xs opacity-90">Reading due · every {intervalHours}h</span>}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
        {duePrompt && (
          <p className="text-sm bg-info/10 border border-info/30 text-info rounded-lg px-3 py-2">
            Reading due ({labels.join(' / ')}, every {intervalHours}h) — soft reminder.
          </p>
        )}

        <div className="overflow-x-auto border border-border rounded-xl bg-card shadow">
          <table className="text-xs border-collapse min-w-[72rem]">
            <thead>
              <tr className="bg-secondary/60">
                <th className="sticky left-0 z-10 bg-secondary/90 p-2 text-left border-r border-border" rowSpan={2}>TIME</th>
                <th className="p-1 border-b border-border" colSpan={3}>LEVEL mm</th>
                <th className="p-1 border-b border-border" colSpan={3}>TEMP °C</th>
                <th className="p-1 border-b border-border" colSpan={3}>ACID %</th>
                <th className="p-1 border-b border-border" colSpan={3}>IRON %</th>
                <th className="p-1 border-b border-border" colSpan={5}>STEAM / BURNER</th>
                <th className="p-1 border-b border-border" colSpan={3}>DOSAGE L/min</th>
                <th className="p-1 border-b border-border" colSpan={4}>HOT RINSE</th>
                <th className="p-1 border-b border-border" colSpan={3}>BOTTOM</th>
              </tr>
              <tr className="bg-secondary/40 text-[9px] uppercase text-muted-foreground">
                {['T1', 'T2', 'T3', 'T1', 'T2', 'T3', 'T1', 'T2', 'T3', 'T1', 'T2', 'T3'].map((h, i) => (
                  <th key={`t${i}`} className="p-1 font-medium">{h}</th>
                ))}
                <th className="p-1">Inlet PRV</th>
                <th className="p-1">Out PRV</th>
                <th className="p-1">Out Burner</th>
                <th className="p-1">Masha</th>
                <th className="p-1">Hot Air</th>
                <th className="p-1">Acid</th>
                <th className="p-1">Water</th>
                <th className="p-1">Inhib</th>
                <th className="p-1">Cl</th>
                <th className="p-1">pH</th>
                <th className="p-1">Flow</th>
                <th className="p-1">Temp</th>
                <th className="p-1">Rinse Acid%</th>
                <th className="p-1">Iron%</th>
                <th className="p-1">Incharge</th>
              </tr>
            </thead>
            <tbody>
              {stacked.map(([time, bucket]) => {
                const L = bucket.line;
                return (
                  <tr key={time} className="border-t border-border">
                    <td className="sticky left-0 z-10 bg-card font-mono font-bold p-2 border-r border-border">{time}</td>
                    {([1, 2, 3] as const).map((n) => (
                      <td key={`lv${n}`} className="p-1 text-center font-mono">{s(bucket.tanks[n]?.tank_level)}</td>
                    ))}
                    {([1, 2, 3] as const).map((n) => (
                      <td key={`tp${n}`} className="p-1 text-center font-mono">{s(bucket.tanks[n]?.tank_temp_degc)}</td>
                    ))}
                    {([1, 2, 3] as const).map((n) => (
                      <td key={`ac${n}`} className="p-1 text-center font-mono">{s(bucket.tanks[n]?.acid_strength_pct)}</td>
                    ))}
                    {([1, 2, 3] as const).map((n) => (
                      <td key={`ir${n}`} className="p-1 text-center font-mono">{s(bucket.tanks[n]?.iron_strength_pct)}</td>
                    ))}
                    <td className="p-1 text-center font-mono">{s(L?.steam_inlet_kgcm2)}</td>
                    <td className="p-1 text-center font-mono">{s(L?.steam_outlet_kgcm2)}</td>
                    <td className="p-1 text-center font-mono">{s(L?.steam_outlet_burner_kgcm2)}</td>
                    <td className="p-1 text-center font-mono">{s(L?.burner_pressure_kgcm2)}</td>
                    <td className="p-1 text-center font-mono">{s(L?.hot_air_temp_degc)}</td>
                    <td className="p-1 text-center font-mono">{s(L?.dosage_acid)}</td>
                    <td className="p-1 text-center font-mono">{s(L?.dosage_water)}</td>
                    <td className="p-1 text-center font-mono">{s(L?.dosage_inhibitor)}</td>
                    <td className="p-1 text-center font-mono">{s(L?.rinse_cl)}</td>
                    <td className="p-1 text-center font-mono">{s(L?.rinse_ph)}</td>
                    <td className="p-1 text-center font-mono">{s(L?.rinse_flow)}</td>
                    <td className="p-1 text-center font-mono">{s(L?.rinse_temp_degc)}</td>
                    <td className="p-1 text-center font-mono">{s(L?.rinse_acid_pct)}</td>
                    <td className="p-1 text-center font-mono">{s(L?.rinse_iron_pct)}</td>
                    <td className="p-1 text-center text-[10px]">{s(L?.line_incharge)}</td>
                  </tr>
                );
              })}

              {/* Add-reading row */}
              <tr className="border-t-2 border-primary/30 bg-primary/5">
                <td className="sticky left-0 z-10 bg-primary/10 p-1 border-r border-border">
                  <input className={`${inputCls} w-20`} value={chartTime} onChange={(e) => setChartTime(e.target.value)} aria-label="Chart time" />
                </td>
                {([1, 2, 3] as const).map((n) => (
                  <td key={`elv${n}`} className="p-0.5">
                    <input className={`${inputCls} ${cellClass(tanks[n].level, 'tank_level', `T${n}`)}`} value={tanks[n].level} onChange={(e) => setTanks({ ...tanks, [n]: { ...tanks[n], level: e.target.value } })} />
                  </td>
                ))}
                {([1, 2, 3] as const).map((n) => (
                  <td key={`etp${n}`} className="p-0.5">
                    <input className={`${inputCls} ${cellClass(tanks[n].temp, 'tank_temp', `T${n}`)}`} value={tanks[n].temp} onChange={(e) => setTanks({ ...tanks, [n]: { ...tanks[n], temp: e.target.value } })} />
                  </td>
                ))}
                {([1, 2, 3] as const).map((n) => (
                  <td key={`eac${n}`} className="p-0.5">
                    <input className={`${inputCls} ${cellClass(tanks[n].acid, 'acid_strength', `T${n}`)}`} value={tanks[n].acid} onChange={(e) => setTanks({ ...tanks, [n]: { ...tanks[n], acid: e.target.value } })} />
                  </td>
                ))}
                {([1, 2, 3] as const).map((n) => (
                  <td key={`eir${n}`} className="p-0.5">
                    <input className={`${inputCls} ${cellClass(tanks[n].iron, 'iron_strength', `T${n}`)}`} value={tanks[n].iron} onChange={(e) => setTanks({ ...tanks, [n]: { ...tanks[n], iron: e.target.value } })} />
                  </td>
                ))}
                <td className="p-0.5"><input className={`${inputCls} ${cellClass(line.steamInlet, 'steam_inlet', 'LINE')}`} value={line.steamInlet} onChange={(e) => setLine({ ...line, steamInlet: e.target.value })} /></td>
                <td className="p-0.5"><input className={`${inputCls} ${cellClass(line.steamOutlet, 'steam_outlet', 'LINE')}`} value={line.steamOutlet} onChange={(e) => setLine({ ...line, steamOutlet: e.target.value })} /></td>
                <td className="p-0.5"><input className={`${inputCls} ${cellClass(line.steamBurner, 'steam_outlet_burner', 'LINE')}`} value={line.steamBurner} onChange={(e) => setLine({ ...line, steamBurner: e.target.value })} /></td>
                <td className="p-0.5"><input className={`${inputCls} ${cellClass(line.masha, 'burner_pressure', 'LINE')}`} value={line.masha} onChange={(e) => setLine({ ...line, masha: e.target.value })} /></td>
                <td className="p-0.5"><input className={`${inputCls} ${cellClass(line.hotAir, 'hot_air_temp', 'LINE')}`} value={line.hotAir} onChange={(e) => setLine({ ...line, hotAir: e.target.value })} /></td>
                <td className="p-0.5"><input className={inputCls} value={line.dosageAcid} onChange={(e) => setLine({ ...line, dosageAcid: e.target.value })} /></td>
                <td className="p-0.5"><input className={inputCls} value={line.dosageWater} onChange={(e) => setLine({ ...line, dosageWater: e.target.value })} /></td>
                <td className="p-0.5"><input className={inputCls} value={line.dosageInhib} onChange={(e) => setLine({ ...line, dosageInhib: e.target.value })} /></td>
                <td className="p-0.5"><input className={`${inputCls} ${cellClass(line.rinseCl, 'rinse_cl', 'RINSE')}`} value={line.rinseCl} onChange={(e) => setLine({ ...line, rinseCl: e.target.value })} /></td>
                <td className="p-0.5"><input className={`${inputCls} ${cellClass(line.rinsePh, 'rinse_ph', 'RINSE')}`} value={line.rinsePh} onChange={(e) => setLine({ ...line, rinsePh: e.target.value })} /></td>
                <td className="p-0.5"><input className={`${inputCls} ${cellClass(line.rinseFlow, 'rinse_flow', 'RINSE')}`} value={line.rinseFlow} onChange={(e) => setLine({ ...line, rinseFlow: e.target.value })} /></td>
                <td className="p-0.5"><input className={`${inputCls} ${cellClass(line.rinseTemp, 'rinse_temp', 'RINSE')}`} value={line.rinseTemp} onChange={(e) => setLine({ ...line, rinseTemp: e.target.value })} /></td>
                <td className="p-0.5"><input className={inputCls} value={line.rinseAcid} onChange={(e) => setLine({ ...line, rinseAcid: e.target.value })} /></td>
                <td className="p-0.5"><input className={inputCls} value={line.rinseIron} onChange={(e) => setLine({ ...line, rinseIron: e.target.value })} /></td>
                <td className="p-0.5"><input className={`${inputCls} w-24`} value={line.lineIncharge} onChange={(e) => setLine({ ...line, lineIncharge: e.target.value })} /></td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <ZButton type="button" onClick={() => void saveChart()} disabled={saving || !shiftLogId}>
            {saving ? 'Saving…' : 'Add Reading'}
          </ZButton>
          <p className="text-xs text-muted-foreground">Out-of-spec cells amber — still saves. Specs advisory only.</p>
          {msg && <p className="text-sm">{msg}</p>}
        </div>
      </div>
    </div>
  );
}
