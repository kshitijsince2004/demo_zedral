import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatPlantTime, plantMinutesOfDay } from '@m1/shared-validation';
import { ZButton } from '../../primitives/ZButton';
import { ZInput } from '../../primitives/ZInput';
import { apiClient } from '../../../lib/apiClient';
import { useShiftStore } from '../../../store/shiftStore';

type SpecLimit = {
  param_key: string;
  tank_scope: string;
  min_val: number | string | null;
  max_val: number | string | null;
  unit: string | null;
};

type TankRow = {
  tankNo: 1 | 2 | 3;
  tankLevel: string;
  tankTempDegc: string;
  acidStrengthPct: string;
  ironStrengthPct: string;
};

const emptyTank = (n: 1 | 2 | 3): TankRow => ({
  tankNo: n, tankLevel: '', tankTempDegc: '', acidStrengthPct: '', ironStrengthPct: '',
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

/** Hourly process chart — independent of coil capture (plan §6). Singletons on T1. */
export function PklChartGrid() {
  const { shiftLogId } = useShiftStore();
  const [chartTime, setChartTime] = useState(formatPlantTime());
  const [labels, setLabels] = useState(['1st', '3rd', '5th', '7th']);
  const [intervalHours, setIntervalHours] = useState(2);
  const [duePrompt, setDuePrompt] = useState(false);
  const [limits, setLimits] = useState<SpecLimit[]>([]);
  const [tanks, setTanks] = useState<TankRow[]>([emptyTank(1), emptyTank(2), emptyTank(3)]);
  const [line, setLine] = useState({
    steamInletKgcm2: '', steamOutletKgcm2: '', burnerPressureKgcm2: '', hotAirTempDegc: '',
    dosageAcid: '', dosageWater: '', dosageInhibitor: '',
    rinseCl: '', rinsePh: '', rinseFlow: '', rinseTempDegc: '', rinseAcidPct: '', rinseIronPct: '',
  });
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

  useEffect(() => { void loadMeta(); }, [loadMeta]);

  useEffect(() => {
    const tick = () => {
      const mins = plantMinutesOfDay();
      const step = Math.max(1, intervalHours) * 60;
      // soft reminder near each interval from shift start (noon-agnostic: every N hours)
      const near = mins % step < 15 || mins % step > step - 15;
      setDuePrompt(near);
    };
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [intervalHours]);

  const warnCount = useMemo(() => {
    let n = 0;
    for (const t of tanks) {
      const scope = `T${t.tankNo}`;
      if (outOfRange(t.tankTempDegc, lim(limits, 'tank_temp', scope).min, lim(limits, 'tank_temp', scope).max)) n += 1;
      if (outOfRange(t.acidStrengthPct, lim(limits, 'acid_strength', scope).min, lim(limits, 'acid_strength', scope).max)) n += 1;
      if (outOfRange(t.ironStrengthPct, lim(limits, 'iron_strength', scope).min, lim(limits, 'iron_strength', scope).max)) n += 1;
      if (outOfRange(t.tankLevel, lim(limits, 'tank_level', scope).min, lim(limits, 'tank_level', scope).max)) n += 1;
    }
    if (outOfRange(line.steamInletKgcm2, lim(limits, 'steam_inlet', 'LINE').min, lim(limits, 'steam_inlet', 'LINE').max)) n += 1;
    if (outOfRange(line.steamOutletKgcm2, lim(limits, 'steam_outlet', 'LINE').min, lim(limits, 'steam_outlet', 'LINE').max)) n += 1;
    if (outOfRange(line.burnerPressureKgcm2, lim(limits, 'burner_pressure', 'LINE').min, lim(limits, 'burner_pressure', 'LINE').max)) n += 1;
    if (outOfRange(line.hotAirTempDegc, lim(limits, 'hot_air_temp', 'LINE').min, lim(limits, 'hot_air_temp', 'LINE').max)) n += 1;
    if (outOfRange(line.rinseFlow, lim(limits, 'rinse_flow', 'RINSE').min, lim(limits, 'rinse_flow', 'RINSE').max)) n += 1;
    if (outOfRange(line.rinseTempDegc, lim(limits, 'rinse_temp', 'RINSE').min, lim(limits, 'rinse_temp', 'RINSE').max)) n += 1;
    if (outOfRange(line.rinsePh, lim(limits, 'rinse_ph', 'RINSE').min, lim(limits, 'rinse_ph', 'RINSE').max)) n += 1;
    if (outOfRange(line.rinseCl, lim(limits, 'rinse_cl', 'RINSE').min, lim(limits, 'rinse_cl', 'RINSE').max)) n += 1;
    return n;
  }, [tanks, line, limits]);

  function num(v: string) { return v === '' ? undefined : Number(v); }

  function cellClass(val: string, key: string, scope: string) {
    const { min, max } = lim(limits, key, scope);
    return outOfRange(val, min, max) ? 'border-amber-400 bg-amber-50' : '';
  }

  async function saveChart() {
    if (!shiftLogId) return;
    setSaving(true);
    setMsg(null);
    try {
      await apiClient.post('/stations/pkl/chart', {
        shiftLogId,
        chartTime,
        tanks: tanks.map((t) => ({
          tankNo: t.tankNo,
          tankLevel: num(t.tankLevel),
          tankTempDegc: num(t.tankTempDegc),
          acidStrengthPct: num(t.acidStrengthPct),
          ironStrengthPct: num(t.ironStrengthPct),
        })),
        line: {
          steamInletKgcm2: num(line.steamInletKgcm2),
          steamOutletKgcm2: num(line.steamOutletKgcm2),
          dosageAcid: num(line.dosageAcid),
          dosageWater: num(line.dosageWater),
          dosageInhibitor: num(line.dosageInhibitor),
          rinseCl: num(line.rinseCl),
          rinsePh: num(line.rinsePh),
          rinseFlow: num(line.rinseFlow),
          rinseTempDegc: num(line.rinseTempDegc),
          rinseAcidPct: num(line.rinseAcidPct),
          rinseIronPct: num(line.rinseIronPct),
          burnerPressureKgcm2: num(line.burnerPressureKgcm2),
          hotAirTempDegc: num(line.hotAirTempDegc),
        },
      });
      setMsg(warnCount ? `Saved with ${warnCount} out-of-spec highlight(s)` : 'Saved');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      {duePrompt && (
        <p className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2">
          Process chart reading due ({labels.join(' / ')}, every {intervalHours}h) — soft reminder only.
        </p>
      )}

      <div className="flex flex-wrap gap-3 items-end">
        <ZInput label="Chart Time (HH:mm)" value={chartTime} onChange={(e) => setChartTime(e.target.value)} />
        <p className="text-xs text-muted-foreground pb-2">Spec limits: advisory only — out-of-range still saves.</p>
      </div>

      <div className="overflow-x-auto border rounded-xl">
        <table className="w-full text-xs">
          <thead className="bg-secondary/40">
            <tr>
              <th className="p-2 text-left">Tank</th>
              <th className="p-2">Level mm</th>
              <th className="p-2">Temp °C</th>
              <th className="p-2">Acid %</th>
              <th className="p-2">Iron %</th>
            </tr>
          </thead>
          <tbody>
            {tanks.map((t, i) => {
              const scope = `T${t.tankNo}`;
              return (
                <tr key={t.tankNo} className="border-t">
                  <td className="p-2 font-semibold">T{t.tankNo}</td>
                  {(['tankLevel', 'tankTempDegc', 'acidStrengthPct', 'ironStrengthPct'] as const).map((field) => {
                    const key = field === 'tankLevel' ? 'tank_level'
                      : field === 'tankTempDegc' ? 'tank_temp'
                        : field === 'acidStrengthPct' ? 'acid_strength' : 'iron_strength';
                    return (
                      <td key={field} className="p-1">
                        <input
                          className={`w-full min-h-9 rounded border px-2 ${cellClass(t[field], key, scope)}`}
                          value={t[field]}
                          onChange={(e) => setTanks(tanks.map((x, j) => j === i ? { ...x, [field]: e.target.value } : x))}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ZInput label="Steam In kg/cm²" className={cellClass(line.steamInletKgcm2, 'steam_inlet', 'LINE')} value={line.steamInletKgcm2} onChange={(e) => setLine({ ...line, steamInletKgcm2: e.target.value })} />
        <ZInput label="Steam Out kg/cm²" className={cellClass(line.steamOutletKgcm2, 'steam_outlet', 'LINE')} value={line.steamOutletKgcm2} onChange={(e) => setLine({ ...line, steamOutletKgcm2: e.target.value })} />
        <ZInput label="Burr Masher kg/cm²" className={cellClass(line.burnerPressureKgcm2, 'burner_pressure', 'LINE')} value={line.burnerPressureKgcm2} onChange={(e) => setLine({ ...line, burnerPressureKgcm2: e.target.value })} />
        <ZInput label="Hot Air °C" className={cellClass(line.hotAirTempDegc, 'hot_air_temp', 'LINE')} value={line.hotAirTempDegc} onChange={(e) => setLine({ ...line, hotAirTempDegc: e.target.value })} />
        <ZInput label="Dosage Acid" value={line.dosageAcid} onChange={(e) => setLine({ ...line, dosageAcid: e.target.value })} />
        <ZInput label="Dosage Water" value={line.dosageWater} onChange={(e) => setLine({ ...line, dosageWater: e.target.value })} />
        <ZInput label="Dosage Inhibitor" value={line.dosageInhibitor} onChange={(e) => setLine({ ...line, dosageInhibitor: e.target.value })} />
        <ZInput label="Rinse Cl" className={cellClass(line.rinseCl, 'rinse_cl', 'RINSE')} value={line.rinseCl} onChange={(e) => setLine({ ...line, rinseCl: e.target.value })} />
        <ZInput label="Rinse pH" className={cellClass(line.rinsePh, 'rinse_ph', 'RINSE')} value={line.rinsePh} onChange={(e) => setLine({ ...line, rinsePh: e.target.value })} />
        <ZInput label="Rinse Flow" className={cellClass(line.rinseFlow, 'rinse_flow', 'RINSE')} value={line.rinseFlow} onChange={(e) => setLine({ ...line, rinseFlow: e.target.value })} />
        <ZInput label="Rinse Temp °C" className={cellClass(line.rinseTempDegc, 'rinse_temp', 'RINSE')} value={line.rinseTempDegc} onChange={(e) => setLine({ ...line, rinseTempDegc: e.target.value })} />
        <ZInput label="Rinse Acid %" value={line.rinseAcidPct} onChange={(e) => setLine({ ...line, rinseAcidPct: e.target.value })} />
        <ZInput label="Rinse Iron %" value={line.rinseIronPct} onChange={(e) => setLine({ ...line, rinseIronPct: e.target.value })} />
      </div>

      {msg && <p className="text-sm">{msg}</p>}
      <ZButton type="button" onClick={() => void saveChart()} disabled={saving || !shiftLogId}>
        {saving ? 'Saving…' : 'Save Chart Reading'}
      </ZButton>
    </div>
  );
}
