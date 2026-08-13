import { useCallback, useEffect, useState } from 'react';
import { AdminShell } from '../../components/layout/admin/AdminShell';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { PklSpecTablePanel } from '../../components/process/PklSpecTablePanel';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { apiClient } from '../../lib/apiClient';
import { useAuthStore } from '../../lib/authStore';

/** PKL spec limits admin — table CRUD + chart interval (MH-2). */
export function PklSpecAdmin() {
  const role = useAuthStore((s) => s.role);
  const useMhShell = role === 'MACHINE_HEAD' || role === 'SUPERVISOR';
  const [intervalHours, setIntervalHours] = useState('2');
  const [error, setError] = useState<string | null>(null);

  const loadInterval = useCallback(async () => {
    const cfg = await apiClient.get<{ config: { interval_hours?: number } | null }>('/stations/pkl/chart-config');
    if (cfg.config?.interval_hours != null) setIntervalHours(String(cfg.config.interval_hours));
  }, []);

  useEffect(() => { void loadInterval().catch((e) => setError(e instanceof Error ? e.message : 'Load failed')); }, [loadInterval]);

  const body = (
    <div className="space-y-6 p-4 max-w-5xl">
      {error && <p className="text-destructive text-sm">{error}</p>}

      <div className="flex gap-3 items-end flex-wrap rounded-lg border border-border bg-card p-4">
        <ZInput label="Interval hours" value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} />
        <ZButton
          type="button"
          onClick={() => void apiClient.post('/stations/pkl/chart-config', { intervalHours: Number(intervalHours) }).then(loadInterval)}
        >
          Save interval
        </ZButton>
      </div>

      <PklSpecTablePanel showDelete title="All specifications" />
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
