import { useCallback, useEffect, useState } from 'react';
import type { LiveSnapshot, MachineHeadDashboardData } from '@m1/shared-validation';
import { CommandMetric } from '../../components/command/CommandMetric';
import { MachineStatusBoard } from '../../components/live/MachineStatusBoard';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { liveService } from '../../lib/liveService';
import { useAuthStore } from '../../lib/authStore';

const POLL_MS = 12_000;

function Section({ title, children, empty }: { title: string; children: React.ReactNode; empty?: boolean }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">{title}</h2>
      {empty ? (
        <p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-xl">
          No data for this section
        </p>
      ) : children}
    </section>
  );
}

export function MachineHeadDashboard() {
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [dashboard, setDashboard] = useState<MachineHeadDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [snap, dash] = await Promise.all([
        liveService.getSnapshot(),
        liveService.getMachineHeadDashboard(),
      ]);
      setSnapshot(snap);
      setDashboard(dash);
      setError(null);
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Unable to load machine dashboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (loading && !snapshot) {
    return (
      <MachineHeadShell title="Machine Dashboard" subtitle="Loading…">
        <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
      </MachineHeadShell>
    );
  }

  const kpis = snapshot?.kpis;
  const machines = snapshot?.machines ?? [];

  return (
    <MachineHeadShell
      title="Machine Dashboard"
      subtitle={
        machineAccess.length > 0
          ? `Assigned: ${machineAccess.join(', ')}${dashboard?.shiftSummary ? ` · Plan ${dashboard.shiftSummary.planDate} · Shift ${dashboard.shiftSummary.shiftCode}` : ''}`
          : 'No machines assigned — contact Plant Head'
      }
      onRefresh={load}
    >
      {error && <p className="text-sm text-destructive">{error}</p>}

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <CommandMetric label="Running" value={String(kpis.runningMachines)} tone="success" />
          <CommandMetric label="Idle" value={String(kpis.idleMachines)} tone="muted" />
          <CommandMetric label="Stoppages" value={String(kpis.currentStoppages)} tone="warning" />
          <CommandMetric label="Active Orders" value={String(kpis.activeOrders)} tone="info" />
        </div>
      )}

      <Section title="Your Machines">
        <MachineStatusBoard machines={machines} />
      </Section>

      {dashboard && (
        <>
          <Section title="Order Queue (Rolling + Skin Pass)" empty={dashboard.orderQueue.length === 0}>
            {dashboard.orderQueue.length > 0 && (
              <ul className="text-sm border border-border rounded-xl divide-y divide-border">
                {dashboard.orderQueue.slice(0, 12).map((o) => (
                  <li key={o.batchNumber} className="px-3 py-2 flex justify-between gap-2 items-center">
                    <span className="font-mono text-primary shrink-0">{o.batchNumber}</span>
                    <span className="text-muted-foreground truncate">{o.customer}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {o.subProcess === 'SKIN_PASS' ? 'Skin Pass' : o.subProcess === 'ROLLING' ? 'Rolling' : o.currentProcess}
                    </span>
                    <span className="text-xs font-semibold shrink-0">{o.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Shift Summary">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <div className="border border-border rounded-xl p-3">
                <p className="text-muted-foreground text-xs">Plan Date</p>
                <p className="font-mono font-semibold">{dashboard.shiftSummary.planDate}</p>
              </div>
              <div className="border border-border rounded-xl p-3">
                <p className="text-muted-foreground text-xs">Shift</p>
                <p className="font-semibold">{dashboard.shiftSummary.shiftCode}</p>
              </div>
              <div className="border border-border rounded-xl p-3">
                <p className="text-muted-foreground text-xs">Target MT</p>
                <p className="font-mono font-semibold">{dashboard.shiftSummary.targetMt}</p>
              </div>
              <div className="border border-border rounded-xl p-3">
                <p className="text-muted-foreground text-xs">Queued MT</p>
                <p className="font-mono font-semibold">{dashboard.shiftSummary.actualMt}</p>
              </div>
              <div className="border border-border rounded-xl p-3">
                <p className="text-muted-foreground text-xs">Orders</p>
                <p className="font-semibold">{dashboard.shiftSummary.orderCount}</p>
              </div>
            </div>
          </Section>

          <Section title="Machine Utilization" empty={dashboard.utilization.length === 0}>
            {dashboard.utilization.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {dashboard.utilization.map((u) => (
                  <div key={u.machineCode} className="border border-border rounded-xl p-3 text-sm">
                    <p className="font-medium truncate">{u.machineName}</p>
                    <p className="text-2xl font-mono font-bold text-primary mt-1">{u.utilizationPct}%</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Breakdowns / Stoppages" empty={dashboard.stoppages.length === 0}>
            {dashboard.stoppages.length > 0 && (
              <ul className="text-xs border border-border rounded-xl divide-y divide-border">
                {dashboard.stoppages.map((s) => (
                  <li key={`${s.batchNumber}-${s.startAt}`} className="px-3 py-2 flex justify-between">
                    <span className="font-mono">{s.batchNumber}</span>
                    <span>{s.category}</span>
                    <span className="text-muted-foreground">{s.machineCode}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Operator Activity" empty={dashboard.operatorActivity.length === 0}>
            {dashboard.operatorActivity.length > 0 && (
              <ul className="text-xs border border-border rounded-xl divide-y divide-border">
                {dashboard.operatorActivity.map((a) => (
                  <li key={`${a.batchNumber}-${a.operatorName}`} className="px-3 py-2 flex justify-between">
                    <span>{a.operatorName}</span>
                    <span className="font-mono text-primary">{a.batchNumber}</span>
                    <span className="text-muted-foreground">{a.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Production History" empty={dashboard.productionHistory.length === 0}>
            {dashboard.productionHistory.length > 0 && (
              <ul className="text-xs border border-border rounded-xl divide-y divide-border">
                {dashboard.productionHistory.map((h) => (
                  <li key={`${h.batchNumber}-${h.completedAt}`} className="px-3 py-2 flex justify-between">
                    <span className="font-mono">{h.batchNumber}</span>
                    <span className="font-mono">{h.weightMt} MT</span>
                    <span className="text-muted-foreground">
                      {new Date(h.completedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </MachineHeadShell>
  );
}
