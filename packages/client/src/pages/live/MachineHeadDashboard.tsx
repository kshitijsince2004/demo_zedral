import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MachineHeadDashboardData } from '@m1/shared-validation';
import { CommandMetric } from '../../components/command/CommandMetric';
import { MachineStatusBoard } from '../../components/live/MachineStatusBoard';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { useLiveSnapshot, LIVE_POLL_MS } from '../../hooks/useLiveSnapshot';
import { liveService } from '../../lib/liveService';
import { useAuthStore } from '../../lib/authStore';
import { ZButton } from '../../components/primitives/ZButton';
import { Download, AlertTriangle } from 'lucide-react';
import { reportingService } from '../../lib/reportingService';
import { ExportProgressModal } from '../../components/export/ExportProgressModal';
import { currentPlantDate } from '../../lib/dateFormat';

function formatDuration(minutes?: number): string {
  if (minutes == null || minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function Section({ title, children, empty }: { title: string; children: ReactNode; empty?: boolean }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground ml-1">{title}</h2>
      <div className="bg-white border border-border rounded-2xl shadow-sm overflow-hidden">
        {empty ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data for this section</p>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

function StatCell({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="p-4">
      <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className={`mt-1 font-bold text-foreground ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

export function MachineHeadDashboard() {
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const { snapshot, loading, error, refresh } = useLiveSnapshot();
  const [dashboard, setDashboard] = useState<MachineHeadDashboardData | null>(null);
  const [dashError, setDashError] = useState<string | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportDate, setExportDate] = useState(currentPlantDate());
  const [exportShift, setExportShift] = useState('');

  const handleExportRejected = async (mode: 'day' | 'shift') => {
    try {
      const scope: Record<string, string> = {
        dateFrom: exportDate,
        dateTo: exportDate,
      };
      if (mode === 'shift') {
        scope.shiftCode = exportShift || dashboard?.shiftSummary.shiftCode || 'A';
      }
      const job = await reportingService.createExport({
        type: 'REJECTED_ORDERS',
        format: 'XLSX',
        scope,
      });
      setExportJobId(job.jobId);
    } catch (e: unknown) {
      alert((e as Error)?.message || 'Export failed to start');
    }
  };

  useEffect(() => {
    if (dashboard?.shiftSummary.shiftCode) {
      setExportShift(dashboard.shiftSummary.shiftCode);
    }
    if (dashboard?.shiftSummary.planDate) {
      setExportDate(dashboard.shiftSummary.planDate);
    }
  }, [dashboard?.shiftSummary.shiftCode, dashboard?.shiftSummary.planDate]);

  const loadDashboard = useCallback(async () => {
    try {
      const dash = await liveService.getMachineHeadDashboard();
      setDashboard(dash);
      setDashError(null);
    } catch (err: unknown) {
      setDashError((err as Error)?.message ?? 'Unable to load machine dashboard');
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
    const id = setInterval(() => void loadDashboard(), LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [loadDashboard]);

  const machines = useMemo(() => {
    const all = snapshot?.machines ?? [];
    if (machineAccess.length === 0) return all;
    const allowed = new Set(machineAccess);
    return all.filter((m) => allowed.has(m.machineCode));
  }, [snapshot?.machines, machineAccess]);

  if (loading && !snapshot) {
    return (
      <MachineHeadShell title="Machine Dashboard" subtitle="Loading…">
        <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
      </MachineHeadShell>
    );
  }

  const kpis = snapshot?.kpis;

  return (
    <MachineHeadShell
      title="Machine Dashboard"
      subtitle={
        machineAccess.length > 0
          ? `Assigned: ${machineAccess.join(', ')}${dashboard?.shiftSummary ? ` · Plan ${dashboard.shiftSummary.planDate} · Shift ${dashboard.shiftSummary.shiftCode}` : ''}`
          : 'No machines assigned — contact Plant Head'
      }
      onRefresh={() => { void refresh(); void loadDashboard(); }}
    >
      {(error || dashError) && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error ?? dashError}
        </div>
      )}

      {machineAccess.length === 0 && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          No machines assigned to your profile. Contact Plant Head for access.
        </div>
      )}

      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <CommandMetric label="Running" value={String(kpis.runningMachines)} tone="success" />
          <CommandMetric label="Idle" value={String(kpis.idleMachines)} tone="muted" />
          <CommandMetric label="Stoppages" value={String(kpis.currentStoppages)} tone="warning" />
          <CommandMetric label="Active Orders" value={String(kpis.activeOrders)} tone="info" />
        </div>
      )}

      <Section title="Your Machines" empty={machines.length === 0}>
        {machines.length > 0 && (
          <div className="p-4 md:p-5">
            <MachineStatusBoard machines={machines} />
          </div>
        )}
      </Section>

      {dashboard && (
        <>
          <Section title="Order Queue (Rolling + Skin Pass)" empty={dashboard.orderQueue.length === 0}>
            {dashboard.orderQueue.length > 0 && (
              <ul className="text-sm divide-y divide-border">
                {dashboard.orderQueue.slice(0, 12).map((o) => (
                  <li
                    key={o.batchNumber}
                    className="px-5 py-4 flex justify-between gap-2 items-center hover:bg-secondary transition-colors"
                  >
                    <span className="font-mono font-bold text-foreground shrink-0">{o.batchNumber}</span>
                    <span className="text-muted-foreground truncate">{o.customer}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {o.subProcess === 'SKIN_PASS' ? 'Skin Pass' : o.subProcess === 'ROLLING' ? 'Rolling' : o.currentProcess}
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wide shrink-0">{o.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Shift Summary">
            <dl className="grid grid-cols-2 md:grid-cols-7 divide-y md:divide-y-0 md:divide-x divide-border">
              <StatCell label="Plan Date" value={dashboard.shiftSummary.planDate} mono />
              <StatCell label="Shift" value={dashboard.shiftSummary.shiftCode} />
              <StatCell label="Target MT" value={dashboard.shiftSummary.targetMt} mono />
              <StatCell
                label="Total MT"
                value={dashboard.shiftSummary.totalProdMt ?? dashboard.shiftSummary.actualMt}
                mono
              />
              <StatCell
                label="Completed MT"
                value={dashboard.shiftSummary.completedProdMt ?? dashboard.shiftSummary.actualMt}
                mono
              />
              <StatCell label="In Progress MT" value={dashboard.shiftSummary.inProgressMt ?? 0} mono />
              <StatCell label="Queued MT" value={dashboard.shiftSummary.queuedMt} mono />
            </dl>
            <p className="px-5 py-2 text-[10px] text-muted-foreground border-t border-border/50">
              {dashboard.shiftSummary.orderCount} orders in queue · {dashboard.shiftSummary.completedOrderCount} completed
            </p>
          </Section>

          <Section title="Runtime Utilization (24h)" empty={dashboard.runtimeUtilization.length === 0}>
            {dashboard.runtimeUtilization.length > 0 && (
              <div className="px-5 py-3 text-xs text-muted-foreground border-b border-border/50 bg-muted/20">
                Running minutes ÷ 24h window from machine state events
              </div>
            )}
            {dashboard.runtimeUtilization.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4">
                {dashboard.runtimeUtilization.map((u) => (
                  <div key={u.machineCode} className="rounded-xl border border-border bg-secondary/30 p-4 text-sm">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground truncate">{u.machineName}</p>
                    <p className="text-2xl font-mono font-bold text-primary mt-2">{u.runtimeUtilizationPct}%</p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Breakdowns / Stoppages" empty={dashboard.stoppages.length === 0}>
            {dashboard.stoppages.length > 0 && (
              <ul className="text-xs divide-y divide-border">
                {dashboard.stoppages.map((s) => (
                  <li key={`${s.batchNumber}-${s.startAt}`} className="px-5 py-3 flex justify-between hover:bg-secondary transition-colors">
                    <span className="font-mono font-bold">{s.batchNumber}</span>
                    <span>{s.category}</span>
                    <span className="text-muted-foreground">{s.machineCode}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Operator Activity" empty={dashboard.operatorActivity.length === 0}>
            {dashboard.operatorActivity.length > 0 && (
              <ul className="text-xs divide-y divide-border">
                {dashboard.operatorActivity.map((a) => (
                  <li key={`${a.batchNumber}-${a.operatorName}`} className="px-5 py-3 flex justify-between hover:bg-secondary transition-colors">
                    <span className="font-semibold">{a.operatorName}</span>
                    <span className="font-mono font-bold text-foreground">{a.batchNumber}</span>
                    <span className="text-muted-foreground">{a.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Production History" empty={dashboard.productionHistory.length === 0}>
            {dashboard.productionHistory.length > 0 && (
              <ul className="text-xs divide-y divide-border">
                {dashboard.productionHistory.map((h) => (
                  <li key={`${h.batchNumber}-${h.completedAt}`} className="px-5 py-3 flex justify-between hover:bg-secondary transition-colors">
                    <span className="font-mono font-bold">{h.batchNumber}</span>
                    <span className="font-mono">{h.weightMt} MT</span>
                    <span className="text-muted-foreground">
                      {new Date(h.completedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title={`Rejected Orders${dashboard.rejectedOrderCount != null ? ` (${dashboard.rejectedOrderCount})` : ''}`}
            empty={!dashboard.rejectedOrders || dashboard.rejectedOrders.length === 0}
          >
            {dashboard.rejectedOrders && dashboard.rejectedOrders.length > 0 && (
              <div className="px-5 pt-3 pb-2 border-b border-border bg-secondary/30 space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <label className="text-xs font-medium text-muted-foreground">
                    Export date
                    <input
                      type="date"
                      value={exportDate}
                      onChange={(e) => setExportDate(e.target.value)}
                      className="mt-1 block rounded-lg border border-border bg-white px-3 py-1.5 text-sm"
                    />
                  </label>
                  <label className="text-xs font-medium text-muted-foreground">
                    Shift
                    <select
                      value={exportShift}
                      onChange={(e) => setExportShift(e.target.value)}
                      className="mt-1 block rounded-lg border border-border bg-white px-3 py-1.5 text-sm"
                    >
                      {['A', 'B', 'C'].map((s) => (
                        <option key={s} value={s}>Shift {s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <ZButton variant="outline" size="sm" onClick={() => handleExportRejected('day')} className="gap-2">
                    <Download className="w-4 h-4" /> Export Day
                  </ZButton>
                  <ZButton variant="outline" size="sm" onClick={() => handleExportRejected('shift')} className="gap-2">
                    <Download className="w-4 h-4" /> Export Shift
                  </ZButton>
                </div>
              </div>
            )}
            {dashboard.rejectedOrders && dashboard.rejectedOrders.length > 0 && (
              <ul className="text-xs divide-y divide-border">
                {dashboard.rejectedOrders.map((r) => (
                  <li key={`${r.batchNumber}-${r.rejectionTime}`} className="px-5 py-3 hover:bg-secondary transition-colors">
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-mono font-bold">{r.batchNumber}</span>
                      <span className="font-mono font-bold text-destructive">{r.weightMt} MT</span>
                    </div>
                    <div className="flex gap-2 items-start mt-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-foreground">{r.reason}</p>
                        <p className="text-muted-foreground mt-0.5">
                          Rejected by {r.rejectedBy} on {new Date(r.rejectionTime).toLocaleString()}
                          {r.machineCode ? ` (${r.machineCode}` : ''}
                          {r.shiftCode ? ` · Shift ${r.shiftCode}` : ''}
                          {r.machineCode ? ')' : ''}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Shift Handover Logs" empty={!dashboard.handoverOverview?.recent || dashboard.handoverOverview.recent.length === 0}>
            {dashboard.handoverOverview?.recent && dashboard.handoverOverview.recent.length > 0 && (
              <ul className="text-xs divide-y divide-border">
                {dashboard.handoverOverview.recent.map((h) => (
                  <li key={h.handoverId} className="px-5 py-3 flex flex-col hover:bg-secondary transition-colors">
                    <div className="flex justify-between mb-1">
                      <span className="font-bold">{h.machineCode}</span>
                      <span className="text-muted-foreground font-mono">Shift {h.outgoingShiftCode} → {h.incomingShiftCode}</span>
                    </div>
                    <div className="text-muted-foreground">
                      <span className="inline-block w-32">Shift Start Time:</span>
                      <span className="font-mono">{new Date(h.shiftStartAt ?? h.createdAt).toLocaleString()}</span>
                    </div>
                    {h.shiftEndAt && (
                      <div className="text-muted-foreground">
                        <span className="inline-block w-32">Shift End Time:</span>
                        <span className="font-mono text-emerald-600">{new Date(h.shiftEndAt).toLocaleString()}</span>
                      </div>
                    )}
                    {h.shiftDurationMinutes != null && (
                      <div className="text-muted-foreground">
                        <span className="inline-block w-32">Duration:</span>
                        <span className="font-mono">{h.shiftDurationLabel ?? formatDuration(h.shiftDurationMinutes)}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {exportJobId && (
            <ExportProgressModal
              jobId={exportJobId}
              onClose={() => setExportJobId(null)}
            />
          )}
        </>
      )}
    </MachineHeadShell>
  );
}
