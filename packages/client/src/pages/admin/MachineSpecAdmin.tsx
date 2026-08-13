import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '../../components/layout/admin/AdminShell';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { apiClient } from '../../lib/apiClient';
import { useAuthStore } from '../../lib/authStore';
import { useOperationalMachineAccess } from '../../lib/useOperationalMachineAccess';

type Spec = {
  specId: string;
  machineCode: string;
  rev: number;
  status: string;
  widthMinMm: number | null;
  widthMaxMm: number | null;
  thkMinMm: number | null;
  thkMaxMm: number | null;
  mandrelIds: number[];
  coilWtMinMt: number | null;
  coilWtMaxMt: number | null;
  exitOdMaxMm: number | null;
  isReferenceSeed: boolean;
  notes: string | null;
};

const EMPTY = {
  machineCode: 'CRS1',
  widthMinMm: '',
  widthMaxMm: '',
  thkMinMm: '',
  thkMaxMm: '',
  mandrelIds: '400,500',
  coilWtMinMt: '',
  coilWtMaxMt: '',
  exitOdMaxMm: '',
  notes: '',
};

/** Machine-head CRS/CTL envelope editor (DRAFT → ACTIVE). */
export function MachineSpecAdmin() {
  const role = useAuthStore((s) => s.role);
  const machines = useOperationalMachineAccess();
  const useMhShell = role === 'MACHINE_HEAD' || role === 'SUPERVISOR';
  const defaultMachine = machines.some((m) => m.toUpperCase().startsWith('CTL'))
    && !machines.some((m) => m.toUpperCase().startsWith('CRS'))
    ? 'CTL'
    : 'CRS1';
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [form, setForm] = useState({ ...EMPTY, machineCode: defaultMachine });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiClient.get<{ specs: Spec[] }>('/machines/specs');
    setSpecs(res.specs ?? []);
  }, []);

  useEffect(() => { void load().catch((e) => setError(e instanceof Error ? e.message : 'Load failed')); }, [load]);

  async function createDraft() {
    setBusy(true);
    setError(null);
    try {
      await apiClient.post('/machines/specs', {
        machineCode: form.machineCode,
        widthMinMm: form.widthMinMm ? Number(form.widthMinMm) : null,
        widthMaxMm: form.widthMaxMm ? Number(form.widthMaxMm) : null,
        thkMinMm: form.thkMinMm ? Number(form.thkMinMm) : null,
        thkMaxMm: form.thkMaxMm ? Number(form.thkMaxMm) : null,
        mandrelIds: form.mandrelIds.split(',').map((s) => Number(s.trim())).filter(Number.isFinite),
        coilWtMinMt: form.coilWtMinMt ? Number(form.coilWtMinMt) : null,
        coilWtMaxMt: form.coilWtMaxMt ? Number(form.coilWtMaxMt) : null,
        exitOdMaxMm: form.exitOdMaxMm ? Number(form.exitOdMaxMm) : null,
        notes: form.notes || null,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  async function activate(specId: string) {
    setBusy(true);
    try {
      await apiClient.post(`/machines/specs/${specId}/activate`, {});
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Activate failed');
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <>
      {error && <p className="text-destructive text-sm mb-3">{error}</p>}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-3 border rounded-xl p-4">
          <h3 className="font-semibold">New draft</h3>
          <ZInput label="Machine" value={form.machineCode} onChange={(e) => setForm({ ...form, machineCode: e.target.value.toUpperCase() })} />
          <ZInput label="Width min/max" value={`${form.widthMinMm}`} onChange={(e) => setForm({ ...form, widthMinMm: e.target.value })} placeholder="min" />
          <ZInput label="Width max" value={form.widthMaxMm} onChange={(e) => setForm({ ...form, widthMaxMm: e.target.value })} />
          <ZInput label="Thk min" value={form.thkMinMm} onChange={(e) => setForm({ ...form, thkMinMm: e.target.value })} />
          <ZInput label="Thk max" value={form.thkMaxMm} onChange={(e) => setForm({ ...form, thkMaxMm: e.target.value })} />
          <ZInput label="Mandrel IDs (csv)" value={form.mandrelIds} onChange={(e) => setForm({ ...form, mandrelIds: e.target.value })} />
          <ZInput label="Coil wt min" value={form.coilWtMinMt} onChange={(e) => setForm({ ...form, coilWtMinMt: e.target.value })} />
          <ZInput label="Coil wt max" value={form.coilWtMaxMt} onChange={(e) => setForm({ ...form, coilWtMaxMt: e.target.value })} />
          <ZInput label="Exit OD max" value={form.exitOdMaxMm} onChange={(e) => setForm({ ...form, exitOdMaxMm: e.target.value })} />
          <ZInput label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <ZButton type="button" disabled={busy} onClick={() => void createDraft()}>Create draft</ZButton>
        </div>
        <div className="space-y-2">
          {specs.map((s) => (
            <div key={s.specId} className="border rounded-lg p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{s.machineCode} · REV {s.rev} · {s.status}</span>
                {s.status === 'DRAFT' && (
                  <ZButton type="button" size="sm" disabled={busy} onClick={() => void activate(s.specId)}>Activate</ZButton>
                )}
              </div>
              <p className="text-muted-foreground mt-1">
                W {s.widthMinMm}–{s.widthMaxMm} · Thk {s.thkMinMm}–{s.thkMaxMm} · ID [{s.mandrelIds.join(',')}]
                {s.isReferenceSeed ? ' · reference seed' : ''}
              </p>
              {s.notes && <p className="text-xs mt-1">{s.notes}</p>}
            </div>
          ))}
        </div>
      </div>
    </>
  );

  if (useMhShell) {
    return (
      <MachineHeadShell title="Machine Specs" subtitle="CRS / CTL envelope — mandrel ID hard-gates; width/thk/wt soft-warn">
        {body}
      </MachineHeadShell>
    );
  }

  return (
    <AdminShell title="Machine Specs" subtitle="CRS / CTL envelope — mandrel ID hard-gates; width/thk/wt soft-warn">
      {body}
    </AdminShell>
  );
}
