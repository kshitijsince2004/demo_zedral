import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '../../components/layout/admin/AdminShell';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { apiClient } from '../../lib/apiClient';
import { useAuthStore } from '../../lib/authStore';

type Limit = {
  param_key: string;
  scope: string;
  min_val: number | string | null;
  max_val: number | string | null;
  unit: string | null;
};

type BaseRow = {
  base_no: string;
  capacity_max_coils: number | null;
  capacity_max_wt_mt: number | string | null;
  capacity_max_height_mm: number | string | null;
};

/** Minimal ANN WI spec-limit CRUD + add base. */
export function AnnSpecAdmin() {
  const role = useAuthStore((s) => s.role);
  const useMhShell = role === 'MACHINE_HEAD' || role === 'SUPERVISOR';
  const [limits, setLimits] = useState<Limit[]>([]);
  const [bases, setBases] = useState<BaseRow[]>([]);
  const [form, setForm] = useState({ paramKey: '', scope: 'ALL', minVal: '', maxVal: '', unit: '' });
  const [baseForm, setBaseForm] = useState({ baseNo: '', maxCoils: '', maxWt: '', maxHeight: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [lims, b] = await Promise.all([
      apiClient.get<{ limits: Limit[] }>('/stations/ann/spec-limits'),
      apiClient.get<{ bases: BaseRow[] }>('/stations/ann/bases'),
    ]);
    setLimits(lims.limits ?? []);
    setBases(b.bases ?? []);
  }, []);

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : 'Load failed')); }, [load]);

  async function addBase() {
    const baseNo = baseForm.baseNo.trim();
    if (!baseNo) {
      setError('Base number required');
      return;
    }
    if (!window.confirm(`Create ANN base ${baseNo.toUpperCase()}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/stations/ann/bases', {
        baseNo,
        capacityMaxCoils: baseForm.maxCoils === '' ? null : Number(baseForm.maxCoils),
        capacityMaxWtMt: baseForm.maxWt === '' ? null : Number(baseForm.maxWt),
        capacityMaxHeightMm: baseForm.maxHeight === '' ? null : Number(baseForm.maxHeight),
      });
      setBaseForm({ baseNo: '', maxCoils: '', maxWt: '', maxHeight: '' });
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Create base failed');
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <div className="space-y-8 max-w-4xl">
      {error && <p className="text-destructive text-sm">{error}</p>}

      <section className="space-y-3">
        <h2 className="text-sm font-bold">Bases</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <ZInput label="base no" value={baseForm.baseNo} onChange={(e) => setBaseForm({ ...baseForm, baseNo: e.target.value })} />
          <ZInput label="max coils" value={baseForm.maxCoils} onChange={(e) => setBaseForm({ ...baseForm, maxCoils: e.target.value })} />
          <ZInput label="max wt MT" value={baseForm.maxWt} onChange={(e) => setBaseForm({ ...baseForm, maxWt: e.target.value })} />
          <ZInput label="max height mm" value={baseForm.maxHeight} onChange={(e) => setBaseForm({ ...baseForm, maxHeight: e.target.value })} />
        </div>
        <ZButton type="button" disabled={busy} onClick={() => void addBase()}>Add base</ZButton>
        <table className="w-full text-sm border rounded-xl overflow-hidden">
          <thead className="bg-secondary/40 text-left">
            <tr><th className="p-2">Base</th><th>Max coils</th><th>Max wt</th><th>Max height</th></tr>
          </thead>
          <tbody>
            {bases.map((b) => (
              <tr key={b.base_no} className="border-t">
                <td className="p-2 font-mono font-semibold">{b.base_no}</td>
                <td>{b.capacity_max_coils ?? '—'}</td>
                <td>{b.capacity_max_wt_mt ?? '—'}</td>
                <td>{b.capacity_max_height_mm ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-bold">WI limits</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <ZInput label="param" value={form.paramKey} onChange={(e) => setForm({ ...form, paramKey: e.target.value })} />
          <ZInput label="scope" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })} />
          <ZInput label="min" value={form.minVal} onChange={(e) => setForm({ ...form, minVal: e.target.value })} />
          <ZInput label="max" value={form.maxVal} onChange={(e) => setForm({ ...form, maxVal: e.target.value })} />
          <ZInput label="unit" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />
        </div>
        <ZButton type="button" onClick={() => void apiClient.post('/stations/ann/spec-limits', {
          paramKey: form.paramKey,
          scope: form.scope,
          minVal: form.minVal === '' ? null : Number(form.minVal),
          maxVal: form.maxVal === '' ? null : Number(form.maxVal),
          unit: form.unit || null,
        }).then(load)}>Upsert limit</ZButton>
        <table className="w-full text-sm border rounded-xl overflow-hidden">
          <thead className="bg-secondary/40 text-left"><tr><th className="p-2">Param</th><th>Scope</th><th>Min</th><th>Max</th><th>Unit</th></tr></thead>
          <tbody>
            {limits.map((l) => (
              <tr key={`${l.param_key}:${l.scope}`} className="border-t">
                <td className="p-2 font-mono">{l.param_key}</td>
                <td>{l.scope}</td>
                <td>{l.min_val ?? '—'}</td>
                <td>{l.max_val ?? '—'}</td>
                <td>{l.unit ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );

  if (useMhShell) {
    return (
      <MachineHeadShell title="Ann Specs" subtitle="Bases + WI limits (advisory)">
        {body}
      </MachineHeadShell>
    );
  }

  return (
    <AdminShell title="ANN Specs" subtitle="Bases + WI limits (advisory)">
      <div className="p-4">{body}</div>
    </AdminShell>
  );
}
