import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '../../components/layout/admin/AdminShell';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { apiClient } from '../../lib/apiClient';

type Limit = {
  param_key: string;
  tank_scope: string;
  min_val: number | string | null;
  max_val: number | string | null;
  unit: string | null;
};

/** Minimal PKL spec-limit + chart-interval CRUD (plan §7). */
export function PklSpecAdmin() {
  const [limits, setLimits] = useState<Limit[]>([]);
  const [intervalHours, setIntervalHours] = useState('2');
  const [form, setForm] = useState({ paramKey: '', tankScope: 'LINE', minVal: '', maxVal: '', unit: '' });
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

  return (
    <AdminShell title="PKL Specs" subtitle="Chart standards + reading interval">
      <div className="space-y-6 p-4 max-w-4xl">
        {error && <p className="text-destructive text-sm">{error}</p>}
        <div className="flex gap-3 items-end">
          <ZInput label="Interval hours" value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} />
          <ZButton type="button" onClick={() => void apiClient.post('/stations/pkl/chart-config', { intervalHours: Number(intervalHours) }).then(load)}>
            Save interval
          </ZButton>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <ZInput label="param" value={form.paramKey} onChange={(e) => setForm({ ...form, paramKey: e.target.value })} />
          <ZInput label="scope" value={form.tankScope} onChange={(e) => setForm({ ...form, tankScope: e.target.value })} />
          <ZInput label="min" value={form.minVal} onChange={(e) => setForm({ ...form, minVal: e.target.value })} />
          <ZInput label="max" value={form.maxVal} onChange={(e) => setForm({ ...form, maxVal: e.target.value })} />
          <ZInput label="unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        </div>
        <ZButton type="button" onClick={() => void apiClient.post('/stations/pkl/spec-limits', {
          paramKey: form.paramKey,
          tankScope: form.tankScope,
          minVal: form.minVal === '' ? null : Number(form.minVal),
          maxVal: form.maxVal === '' ? null : Number(form.maxVal),
          unit: form.unit || null,
        }).then(load)}>Upsert limit</ZButton>
        <table className="w-full text-sm border rounded-xl overflow-hidden">
          <thead className="bg-secondary/40 text-left"><tr><th className="p-2">Param</th><th>Scope</th><th>Min</th><th>Max</th><th>Unit</th></tr></thead>
          <tbody>
            {limits.map((l) => (
              <tr key={`${l.param_key}:${l.tank_scope}`} className="border-t">
                <td className="p-2 font-mono">{l.param_key}</td>
                <td>{l.tank_scope}</td>
                <td>{l.min_val ?? '—'}</td>
                <td>{l.max_val ?? '—'}</td>
                <td>{l.unit ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
