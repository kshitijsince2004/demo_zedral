import { useCallback, useEffect, useState } from 'react';
import type { LiveSnapshot, MachineStatusCard } from '@m1/shared-validation';
import { MachineStatusBoard } from '../../components/live/MachineStatusBoard';
import { MachineDetailModal } from '../../components/live/MachineDetailModal';
import { liveService } from '../../lib/liveService';
import { CommandMetric } from '../../components/command/CommandMetric';

const POLL_MS = 12_000;

export function PlantLineStatus() {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [machines, setMachines] = useState<MachineStatusCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMachineCode, setSelectedMachineCode] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [snap, machinesRes] = await Promise.all([
        liveService.getSnapshot(),
        liveService.getMachines(),
      ]);
      setSnapshot(snap);
      setMachines(machinesRes.machines);
      setRefreshedAt(machinesRes.refreshedAt);
      setError(null);
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Unable to load line status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const selectedMachine = machines.find((m) => m.machineCode === selectedMachineCode) ?? null;
  const kpis = snapshot?.kpis;

  if (loading && !snapshot) {
    return <div className="py-16 text-center text-muted-foreground text-sm">Loading line status…</div>;
  }

  return (
    <div className="flex flex-col gap-6 w-full max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Line Status Board</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time machine status, orders, and shift activity
          </p>
        </div>
        {refreshedAt && (
          <span className="text-xs text-muted-foreground">
            Updated {new Date(refreshedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 p-4 rounded-xl">{error}</p>
      )}

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <CommandMetric label="Running" value={String(kpis.runningMachines)} tone="success" />
          <CommandMetric label="Idle" value={String(kpis.idleMachines)} tone="muted" />
          <CommandMetric label="Stoppages" value={String(kpis.currentStoppages)} tone="warning" />
          <CommandMetric label="Active Orders" value={String(kpis.activeOrders)} tone="info" />
        </div>
      )}

      <MachineStatusBoard
        machines={machines}
        onSelect={(code) => setSelectedMachineCode(code)}
      />

      <MachineDetailModal
        open={!!selectedMachineCode}
        onClose={() => setSelectedMachineCode(null)}
        machineCode={selectedMachineCode}
        machineData={selectedMachine ?? undefined}
      />
    </div>
  );
}
