import { AdminShell } from '../../components/layout/admin/AdminShell';
import { useCallback, useEffect, useState } from 'react';
import type { MachineAccessEntry } from '@m1/shared-validation';

import { ZButton } from '../../components/primitives/ZButton';
import { apiClient } from '../../lib/apiClient';
import { MACHINE_OPTIONS } from '../../lib/accessOptions';

export function MachineAssignmentPage() {
  const [entries, setEntries] = useState<MachineAccessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<MachineAccessEntry[]>('/machine-access');
      setEntries(data);
      const d: Record<string, string[]> = {};
      for (const e of data) {
        const fromMachines = e.machines.map((m) => m.machineCode);
        d[e.userId] = fromMachines.length > 0
          ? fromMachines
          : e.lineAccess.map((l) => l.lineId);
      }
      setDraft(d);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleMachine = (userId: string, code: string) => {
    setDraft((prev) => {
      const current = prev[userId] ?? [];
      const next = current.includes(code)
        ? current.filter((c) => c !== code)
        : [...current, code];
      return { ...prev, [userId]: next };
    });
  };

  const save = async (userId: string) => {
    setSaving(userId);
    try {
      await apiClient.put(`/machine-access/${userId}`, {
        machineCodes: draft[userId] ?? [],
      });
      await load();
    } finally {
      setSaving(null);
    }
  };

  return (
    <AdminShell
      title="User Access"
      subtitle="Assign mills and lines (syncs login scope automatically)"
      onRefresh={load}
    >
      {loading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">No users found.</p>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <div key={entry.userId} className="border border-border rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{entry.displayName}</p>
                  <p className="text-xs text-muted-foreground">
                    {entry.username}
                    {entry.role && <> · {entry.role}</>}
                  </p>
                </div>
                <ZButton
                  variant="accent"
                  size="sm"
                  onClick={() => save(entry.userId)}
                  disabled={saving === entry.userId}
                >
                  {saving === entry.userId ? 'Saving…' : 'Save'}
                </ZButton>
              </div>
              <div className="flex flex-wrap gap-2">
                {MACHINE_OPTIONS.map((code) => {
                  const selected = (draft[entry.userId] ?? []).includes(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => toggleMachine(entry.userId, code)}
                      className={[
                        'px-3 py-1.5 rounded-lg border text-xs font-bold font-mono transition-colors',
                        selected ? 'bg-primary text-white border-primary' : 'border-border hover:bg-muted/30',
                      ].join(' ')}
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
