import { useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { AdminShell } from '../../components/layout/admin/AdminShell';
import { AdminPanel } from '../../components/admin/AdminPanel';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { FieldWrapper } from '../../components/forms/FieldWrapper';
import { apiClient } from '../../lib/apiClient';
import { StatusBadge } from '../../components/ui/StatusBadge';

type MachineRow = {
  machineCode: string;
  name: string;
  processCode: string | null;
  machineStatus: string;
  machineType: string;
  department: string | null;
  capacityMt: number | null;
  supportsRolling: boolean;
  supportsSkinPass: boolean;
};

const EMPTY_FORM = {
  machineCode: '',
  name: '',
  processCode: '6HI',
  machineType: 'CRM_COMBO',
  department: '',
  capacityMt: '',
  supportsRolling: true,
  supportsSkinPass: true,
};

export function MachineMasterAdmin() {
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MachineRow | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiClient.get<MachineRow[]>('/machines/master?includeOffline=true');
      setMachines(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load machines');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (row: MachineRow) => {
    setEditing(row);
    setForm({
      machineCode: row.machineCode,
      name: row.name,
      processCode: row.processCode ?? '6HI',
      machineType: row.machineType,
      department: row.department ?? '',
      capacityMt: row.capacityMt != null ? String(row.capacityMt) : '',
      supportsRolling: row.supportsRolling,
      supportsSkinPass: row.supportsSkinPass,
    });
    setFormOpen(true);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        machineCode: form.machineCode,
        name: form.name,
        processCode: form.processCode,
        machineType: form.machineType,
        department: form.department || undefined,
        capacityMt: form.capacityMt ? Number(form.capacityMt) : undefined,
        supportsRolling: form.supportsRolling,
        supportsSkinPass: form.supportsSkinPass,
      };
      if (editing) {
        await apiClient.put(`/machines/master/${encodeURIComponent(editing.machineCode)}`, payload);
      } else {
        await apiClient.post('/machines/master', payload);
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (machineCode: string, machineStatus: 'OPERATIONAL' | 'OFFLINE' | 'MAINTENANCE') => {
    setBusy(true);
    try {
      await apiClient.patch(`/machines/master/${encodeURIComponent(machineCode)}/status`, { machineStatus });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminShell title="Machine Master" subtitle="Single source of truth for all machine references">
      <AdminPanel title="Registered Machines">
        <div className="flex justify-between items-center mb-4">
          <p className="text-sm text-muted-foreground">
            New machines appear automatically across live boards, assignment, and dashboards.
          </p>
          <div className="flex gap-2">
            <ZButton variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </ZButton>
            <ZButton variant="accent" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Add Machine
            </ZButton>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="overflow-x-auto border border-border rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border bg-secondary/30">
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Capabilities</th>
                <th className="px-4 py-2">Department</th>
                <th className="px-4 py-2">Capacity</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {machines.map((m) => (
                <tr key={m.machineCode} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5 font-mono font-bold">{m.machineCode}</td>
                  <td className="px-4 py-2.5">{m.name}</td>
                  <td className="px-4 py-2.5">{m.machineType}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {[m.supportsRolling && 'Rolling', m.supportsSkinPass && 'Skin Pass'].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-2.5">{m.department ?? '—'}</td>
                  <td className="px-4 py-2.5">{m.capacityMt != null ? `${m.capacityMt} MT` : '—'}</td>
                  <td className="px-4 py-2.5">
                    <StatusBadge
                      tone={
                        m.machineStatus === 'OPERATIONAL'
                          ? 'success'
                          : m.machineStatus === 'MAINTENANCE'
                            ? 'warning'
                            : 'muted'
                      }
                      label={m.machineStatus}
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2 flex-wrap">
                      <button type="button" className="text-xs underline" onClick={() => openEdit(m)}>Edit</button>
                      {m.machineStatus !== 'OFFLINE' ? (
                        <button type="button" className="text-xs underline text-destructive" onClick={() => void setStatus(m.machineCode, 'OFFLINE')}>Disable</button>
                      ) : (
                        <button type="button" className="text-xs underline text-emerald-600" onClick={() => void setStatus(m.machineCode, 'OPERATIONAL')}>Enable</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminPanel>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-background p-5 space-y-4">
            <h3 className="text-lg font-bold">{editing ? 'Edit Machine' : 'Add Machine'}</h3>
            <div className="grid grid-cols-2 gap-3">
              <FieldWrapper label="Machine Code">
                <ZInput value={form.machineCode} onChange={(e) => setForm({ ...form, machineCode: e.target.value.toUpperCase() })} disabled={!!editing} />
              </FieldWrapper>
              <FieldWrapper label="Machine Name">
                <ZInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </FieldWrapper>
              <FieldWrapper label="Process Code">
                <ZInput value={form.processCode} onChange={(e) => setForm({ ...form, processCode: e.target.value.toUpperCase() })} />
              </FieldWrapper>
              <FieldWrapper label="Machine Type">
                <select
                  value={form.machineType}
                  onChange={(e) => setForm({ ...form, machineType: e.target.value })}
                  className="w-full min-h-10 rounded-lg border border-border px-3"
                >
                  <option value="CRM_ROLLING">CRM Rolling</option>
                  <option value="CRM_SKIN_PASS">CRM Skin Pass</option>
                  <option value="CRM_COMBO">CRM Combo</option>
                  <option value="PLANT">Plant Line</option>
                </select>
              </FieldWrapper>
              <FieldWrapper label="Department">
                <ZInput value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
              </FieldWrapper>
              <FieldWrapper label="Capacity (MT)">
                <ZInput type="number" value={form.capacityMt} onChange={(e) => setForm({ ...form, capacityMt: e.target.value })} />
              </FieldWrapper>
            </div>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.supportsRolling} onChange={(e) => setForm({ ...form, supportsRolling: e.target.checked })} />
                Supports Rolling
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.supportsSkinPass} onChange={(e) => setForm({ ...form, supportsSkinPass: e.target.checked })} />
                Supports Skin Pass
              </label>
            </div>
            <div className="flex gap-2 justify-end">
              <ZButton variant="ghost" onClick={() => setFormOpen(false)}>Cancel</ZButton>
              <ZButton variant="accent" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</ZButton>
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  );
}
