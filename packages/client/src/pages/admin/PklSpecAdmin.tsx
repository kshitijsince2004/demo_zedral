import { useCallback, useEffect, useMemo, useState } from 'react';
import { AdminShell } from '../../components/layout/admin/AdminShell';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { apiClient } from '../../lib/apiClient';
import { useAuthStore } from '../../lib/authStore';

type Limit = {
  param_key: string;
  tank_scope: string;
  min_val: number | string | null;
  max_val: number | string | null;
  unit: string | null;
};

const PARAM_LABELS: Record<string, string> = {
  tank_temp: 'Tank Temp °C',
  tank_level: 'Tank Level mm',
  acid_strength: 'Acid Strength %',
  iron_strength: 'Iron Strength %',
  steam_inlet: 'Steam Inlet below PRV',
  steam_outlet: 'Steam Outlet of PRV',
  steam_outlet_burner: 'Steam Outlet of Burner',
  burner_pressure: 'Burner Masha',
  hot_air_temp: 'Hot Air Temp °C',
  rinse_flow: 'Rinse Flow',
  rinse_temp: 'Rinse Temp °C',
  rinse_ph: 'Rinse pH',
  rinse_cl: 'Rinse Cl',
};

const SCOPES = ['T1', 'T2', 'T3', 'RINSE', 'LINE'] as const;

/** Full CRUD PKL spec limits + chart interval (revamp MH-2). Soft-delete via is_active. */
export function PklSpecAdmin() {
  const role = useAuthStore((s) => s.role);
  const useMhShell = role === 'MACHINE_HEAD' || role === 'SUPERVISOR';
  const [limits, setLimits] = useState<Limit[]>([]);
  const [intervalHours, setIntervalHours] = useState('2');
  const [form, setForm] = useState({ paramKey: 'tank_temp', tankScope: 'T1', minVal: '', maxVal: '', unit: 'C' });
  const [editKey, setEditKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [lims, cfg] = await Promise.all([
      apiClient.get<{ limits: Limit[] }>('/stations/pkl/spec-limits'),
      apiClient.get<{ config: { interval_hours?: number } | null }>('/stations/pkl/chart-config'),
    ]);
    setLimits(lims.limits ?? []);
    if (cfg.config?.interval_hours != null) setIntervalHours(String(cfg.config.interval_hours));
  }, []);

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : 'Load failed')); }, [load]);

  const grouped = useMemo(() => {
    const m = new Map<string, Limit[]>();
    for (const scope of SCOPES) m.set(scope, []);
    for (const l of limits) {
      const list = m.get(l.tank_scope) ?? [];
      list.push(l);
      m.set(l.tank_scope, list);
    }
    return m;
  }, [limits]);

  async function saveLimit(active = true) {
    const min = form.minVal === '' ? null : Number(form.minVal);
    const max = form.maxVal === '' ? null : Number(form.maxVal);
    if (min != null && max != null && min > max) {
      setError('Min must be ≤ max');
      return;
    }
    setError(null);
    await apiClient.post('/stations/pkl/spec-limits', {
      paramKey: form.paramKey,
      tankScope: form.tankScope,
      minVal: min,
      maxVal: max,
      unit: form.unit || null,
      isActive: active,
    });
    setEditKey(null);
    await load();
  }

  function startEdit(l: Limit) {
    setEditKey(`${l.param_key}:${l.tank_scope}`);
    setForm({
      paramKey: l.param_key,
      tankScope: l.tank_scope,
      minVal: l.min_val != null ? String(l.min_val) : '',
      maxVal: l.max_val != null ? String(l.max_val) : '',
      unit: l.unit ?? '',
    });
  }

  const body = (
    <div className="space-y-6 p-4 max-w-5xl">
      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex gap-3 items-end flex-wrap">
        <ZInput label="Interval hours" value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} />
        <ZButton type="button" onClick={() => void apiClient.post('/stations/pkl/chart-config', { intervalHours: Number(intervalHours) }).then(load)}>
          Save interval
        </ZButton>
      </div>

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          {editKey ? 'Update limit' : 'Create limit'}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Param</p>
            <select
              className="w-full min-h-10 rounded-xl border border-input bg-background px-3 text-sm"
              value={form.paramKey}
              onChange={(e) => setForm({ ...form, paramKey: e.target.value })}
            >
              {Object.keys(PARAM_LABELS).map((k) => (
                <option key={k} value={k}>{PARAM_LABELS[k]}</option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-[10px] uppercase text-muted-foreground mb-1">Scope</p>
            <select
              className="w-full min-h-10 rounded-xl border border-input bg-background px-3 text-sm"
              value={form.tankScope}
              onChange={(e) => setForm({ ...form, tankScope: e.target.value })}
            >
              {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <ZInput label="Min" value={form.minVal} onChange={(e) => setForm({ ...form, minVal: e.target.value })} />
          <ZInput label="Max" value={form.maxVal} onChange={(e) => setForm({ ...form, maxVal: e.target.value })} />
          <ZInput label="Unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        </div>
        <div className="flex gap-2">
          <ZButton type="button" onClick={() => void saveLimit(true)}>{editKey ? 'Update' : 'Create'}</ZButton>
          {editKey && (
            <ZButton type="button" variant="secondary" onClick={() => { setEditKey(null); setForm({ paramKey: 'tank_temp', tankScope: 'T1', minVal: '', maxVal: '', unit: 'C' }); }}>
              Cancel
            </ZButton>
          )}
        </div>
      </div>

      {[...grouped.entries()].map(([scope, rows]) => (
        rows.length === 0 ? null : (
          <div key={scope}>
            <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">{scope}</h3>
            <table className="w-full text-sm border rounded-xl overflow-hidden mb-4">
              <thead className="bg-secondary/40 text-left">
                <tr>
                  <th className="p-2">Param</th>
                  <th>Min</th>
                  <th>Max</th>
                  <th>Unit</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={`${l.param_key}:${l.tank_scope}`} className="border-t">
                    <td className="p-2">{PARAM_LABELS[l.param_key] ?? l.param_key}</td>
                    <td className="font-mono">{l.min_val ?? '—'}</td>
                    <td className="font-mono">{l.max_val ?? '—'}</td>
                    <td>{l.unit ?? '—'}</td>
                    <td className="p-2 flex gap-2">
                      <ZButton type="button" variant="secondary" size="sm" onClick={() => startEdit(l)}>Edit</ZButton>
                      <ZButton
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void apiClient.post('/stations/pkl/spec-limits', {
                          paramKey: l.param_key, tankScope: l.tank_scope, isActive: false,
                        }).then(load)}
                      >
                        Delete
                      </ZButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ))}
    </div>
  );

  if (useMhShell) {
    return (
      <MachineHeadShell title="PKL Specs" subtitle="Chart standards + reading interval">
        {body}
      </MachineHeadShell>
    );
  }

  return (
    <AdminShell title="PKL Specs" subtitle="Chart standards + reading interval">
      {body}
    </AdminShell>
  );
}
