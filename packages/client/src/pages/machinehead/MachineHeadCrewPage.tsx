import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../components/primitives/ZButton';
import { machineCrewService, type MachineCrewMember } from '../../lib/machineCrewService';
import { ApiError } from '../../lib/apiClient';
import { useOperationalMachineAccess } from '../../lib/useOperationalMachineAccess';

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export function MachineHeadCrewPage() {
  const machines = useOperationalMachineAccess();
  const [machineCode, setMachineCode] = useState(machines[0] ?? '');
  const [crew, setCrew] = useState<MachineCrewMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [memberName, setMemberName] = useState('');
  const [roleLabel, setRoleLabel] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (machines.length === 0) {
      setMachineCode('');
      return;
    }
    if (!machines.includes(machineCode)) {
      setMachineCode(machines[0]);
    }
  }, [machines, machineCode]);

  const load = useCallback(async () => {
    if (!machineCode) {
      setCrew([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await machineCrewService.list(machineCode);
      setCrew(res.crew);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Failed to load crew'));
      setCrew([]);
    } finally {
      setLoading(false);
    }
  }, [machineCode]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setMemberName('');
    setRoleLabel('');
  };

  const handleSave = async () => {
    if (!memberName.trim() || !roleLabel.trim()) {
      setError('Name and role are required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await machineCrewService.update(editingId, {
          machineCode,
          memberName: memberName.trim(),
          roleLabel: roleLabel.trim(),
        });
      } else {
        await machineCrewService.create({
          machineCode,
          memberName: memberName.trim(),
          roleLabel: roleLabel.trim(),
        });
      }
      resetForm();
      await load();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Save failed'));
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = (member: MachineCrewMember) => {
    setEditingId(member.id);
    setMemberName(member.memberName);
    setRoleLabel(member.roleLabel);
  };

  const handleDelete = async (member: MachineCrewMember) => {
    if (!window.confirm(`Remove ${member.memberName} from the crew roster?`)) return;
    setBusy(true);
    try {
      await machineCrewService.remove(member.id, machineCode);
      if (editingId === member.id) resetForm();
      await load();
    } catch (err: unknown) {
      setError(errorMessage(err, 'Delete failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <MachineHeadShell title="Crew Management" subtitle="Maintain crew roster for shift handover quick-select">
      <div className="max-w-2xl space-y-4">
        <div className="bg-white border border-border rounded-2xl p-4 shadow-sm">
          <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground block mb-2">
            Machine
          </label>
          {machines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No machines assigned. Ask an admin to grant machine access for this account.
            </p>
          ) : (
            <select
              value={machineCode}
              onChange={(e) => setMachineCode(e.target.value)}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
            >
              {machines.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          )}
        </div>

        <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-border flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">Crew Roster</h2>
            <span className="text-xs text-muted-foreground ml-auto">{crew.length} members</span>
          </div>

          {loading ? (
            <p className="p-5 text-sm text-muted-foreground">Loading crew…</p>
          ) : crew.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No crew members yet. Add the first member below.</p>
          ) : (
            <ul className="divide-y divide-border">
              {crew.map((member) => (
                <li key={member.id} className="px-5 py-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-foreground">{member.memberName}</p>
                    <p className="text-xs text-muted-foreground">{member.roleLabel}</p>
                  </div>
                  <ZButton variant="ghost" size="sm" onClick={() => handleEdit(member)} disabled={busy}>
                    <Pencil className="h-4 w-4" />
                  </ZButton>
                  <ZButton variant="ghost" size="sm" onClick={() => void handleDelete(member)} disabled={busy}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </ZButton>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border border-border rounded-2xl p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
            {editingId ? 'Edit Crew Member' : 'Add Crew Member'}
          </h3>
          <input
            type="text"
            value={memberName}
            onChange={(e) => setMemberName(e.target.value)}
            placeholder="Name"
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
          />
          <input
            type="text"
            value={roleLabel}
            onChange={(e) => setRoleLabel(e.target.value)}
            placeholder="Role / Designation"
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <ZButton variant="primary" onClick={() => void handleSave()} disabled={busy || !machineCode}>
              <Plus className="h-4 w-4" />
              {editingId ? 'Update Member' : 'Add Member'}
            </ZButton>
            {editingId && (
              <ZButton variant="secondary" onClick={resetForm} disabled={busy}>
                Cancel
              </ZButton>
            )}
          </div>
        </div>
      </div>
    </MachineHeadShell>
  );
}
