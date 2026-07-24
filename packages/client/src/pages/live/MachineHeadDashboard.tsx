import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { LiveOrderRow, MachineHeadDashboardData } from '@m1/shared-validation';
import { CommandMetric } from '../../components/command/CommandMetric';
import { MachineStatusBoard } from '../../components/live/MachineStatusBoard';
import { MachineDetailModal } from '../../components/live/MachineDetailModal';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { MachineHeadOrderSidePanel } from '../../components/machinehead/MachineHeadOrderSidePanel';
import { MachineHeadOrderDetailModal } from '../../components/machinehead/MachineHeadOrderDetailModal';
import { ZPillTabs } from '../../components/ui/operator/ZPillTabs';
import { useLiveSnapshot, LIVE_POLL_MS } from '../../hooks/useLiveSnapshot';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { liveService } from '../../lib/liveService';
import { useAuthStore } from '../../lib/authStore';
import { ZButton } from '../../components/primitives/ZButton';
import { useOperationalMachineAccess } from '../../lib/useOperationalMachineAccess';
import { Download, AlertTriangle } from 'lucide-react';
import { OrderIdentityDisplay } from '../../components/orders/OrderIdentityDisplay';
import { displayMotherCoilId } from '../../lib/sixHiOrderIdentity';
import { reportingService } from '../../lib/reportingService';
import { ExportProgressModal } from '../../components/export/ExportProgressModal';
import { currentPlantDate, formatPlantDateTime } from '../../lib/dateFormat';
import { apiClient } from '../../lib/apiClient';
import { deleteOrder } from '../../lib/sync/sixHiWrites';
import { postQueued } from '../../lib/sync/queuedApi';
import { invalidateAfterWrite } from '../../lib/sync/invalidateAfterWrite';
import { jsonFingerprint } from '../../lib/silentRefresh';
import { formatOrderStatusLabel, formatProcessFilterLabel } from '../../lib/orderLabels';
import type { MachineStatusCard } from '@m1/shared-validation';

type DashboardTab = 'overview' | 'orders' | 'production' | 'stoppages' | 'rejected' | 'completed' | 'handover';
type ProcessFilter = 'ALL' | 'ROLLING' | 'SKIN_PASS';

const ORDER_TABS: DashboardTab[] = ['orders', 'production', 'stoppages', 'rejected', 'completed'];
const PROCESS_FILTER_TABS: DashboardTab[] = [...ORDER_TABS, 'handover'];

/** Active shopfloor statuses that belong on the Orders tab (includes stoppage). */
const ACTIVE_ORDER_STATUSES = new Set(['PREPARING', 'IN_PROGRESS', 'RUNNING', 'STOPPAGE']);

function matchesProcessFilter(subProcess: string | undefined, filter: ProcessFilter, allowUnknown = false): boolean {
  if (filter === 'ALL') return true;
  if (!subProcess) return allowUnknown;
  return subProcess === filter;
}

function formatDuration(minutes?: number): string {
  if (minutes == null || minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Live HH:MM:SS for active stoppages; static minutes for ended ones. */
function StoppageDurationCell({
  startAt,
  active,
  durationMin,
}: {
  startAt?: string;
  active: boolean;
  durationMin?: number;
}) {
  const { formatted } = useLiveTimer(startAt, active && !!startAt);
  if (active && startAt) return <>{formatted || '—'}</>;
  return <>{formatDuration(durationMin)}</>;
}

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`z-card overflow-hidden flex flex-col min-h-0 ${className}`}>
      {children}
    </div>
  );
}

function PanelHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-border/70 z-tint flex flex-wrap items-center justify-between gap-3 shrink-0">
      <h3 className="z-eyebrow">{title}</h3>
      {children}
    </div>
  );
}

function PanelBody({ children, empty, emptyLabel = 'No data' }: { children: ReactNode; empty?: boolean; emptyLabel?: string }) {
  if (empty) {
    return <p className="text-sm text-muted-foreground py-10 text-center">{emptyLabel}</p>;
  }
  return <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>;
}

function StatCell({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="px-4 py-3">
      <dt className="z-eyebrow">{label}</dt>
      <dd className={`mt-1 text-base font-bold text-foreground tabular-nums ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function liveRowFromQueue(o: MachineHeadDashboardData['orderQueue'][0]): LiveOrderRow {
  return o;
}

function identityFromRow(r: {
  batchNumber: string;
  motherCoil?: string;
  coilNo?: string;
  slitId?: string;
}) {
  const coil = (r.motherCoil ?? r.coilNo ?? r.batchNumber).trim() || r.batchNumber;
  return {
    batchNumber: r.batchNumber,
    motherCoil: r.motherCoil ?? r.coilNo ?? coil,
    coilNo: r.coilNo ?? r.motherCoil ?? coil,
    slitId: r.slitId,
  };
}

function liveRowFromHistory(h: MachineHeadDashboardData['productionHistory'][0], dashboard: MachineHeadDashboardData): LiveOrderRow {
  const match = dashboard.orderQueue.find((q) => q.batchNumber === h.batchNumber);
  const id = identityFromRow(h);
  return match ?? {
    batchNumber: h.batchNumber,
    customer: '—',
    grade: '—',
    machineCode: h.machineCode ?? '—',
    machineName: h.machineCode ?? '—',
    currentProcess: h.subProcess === 'SKIN_PASS' ? 'Skin Pass' : 'Rolling',
    status: 'COMPLETED',
    weightMt: h.weightMt,
    coilNo: id.coilNo,
    motherCoil: id.motherCoil,
    slitId: id.slitId,
  };
}

function liveRowFromRejected(r: NonNullable<MachineHeadDashboardData['rejectedOrders']>[0] | import('@m1/shared-validation').RejectedOrderRow): LiveOrderRow {
  const id = identityFromRow(r);
  return {
    batchNumber: r.batchNumber,
    customer: '—',
    grade: '—',
    machineCode: r.machineCode,
    machineName: r.machineCode,
    currentProcess: r.subProcess === 'SKIN_PASS' ? 'Skin Pass' : 'Rolling',
    status: 'REJECTED',
    weightMt: r.weightMt,
    coilNo: id.coilNo,
    motherCoil: id.motherCoil,
    slitId: id.slitId,
    shiftCode: r.shiftCode,
  };
}

const DASHBOARD_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'orders', label: 'Orders' },
  { id: 'stoppages', label: 'Stoppages' },
  { id: 'completed', label: 'Completed' },
  { id: 'production', label: 'Production' },
  { id: 'rejected', label: 'Order Hold' },
  { id: 'handover', label: 'Handover' },
] as const;

export function MachineHeadDashboard() {
  const role = useAuthStore((s) => s.role);
  const assignedMachines = useOperationalMachineAccess();
  const { snapshot, loading, error, refresh } = useLiveSnapshot();
  const [dashboard, setDashboard] = useState<MachineHeadDashboardData | null>(null);
  const [dashError, setDashError] = useState<string | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportDate, setExportDate] = useState(currentPlantDate());
  const [exportShift, setExportShift] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<LiveOrderRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [reinstateBusy, setReinstateBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [rejectedOrders, setRejectedOrders] = useState<NonNullable<MachineHeadDashboardData['rejectedOrders']>>([]);
  const [rejectedLoading, setRejectedLoading] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [completedOrders, setCompletedOrders] = useState<any[]>([]);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [processFilter, setProcessFilter] = useState<ProcessFilter>('ALL');
  const [machineFilter, setMachineFilter] = useState<string>('ALL');
  const [shiftFilter, setShiftFilter] = useState<string>('ALL');
  const [stoppageReason, setStoppageReason] = useState<string>('ALL');
  const [orderSearch, setOrderSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [machineModalCode, setMachineModalCode] = useState<string | null>(null);
  const [machineModalData, setMachineModalData] = useState<MachineStatusCard | undefined>();
  const prevDashboardFpRef = useRef('');

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(orderSearch.trim()), 300);
    return () => clearTimeout(id);
  }, [orderSearch]);

  const handleExportRejected = async (mode: 'day' | 'shift') => {
    try {
      const scope: Record<string, string> = {
        dateFrom: exportDate,
        dateTo: exportDate,
      };
      if (mode === 'shift') {
        scope.shiftCode = exportShift || dashboard?.shiftSummary.shiftCode || '';
        if (!scope.shiftCode) {
          alert('Select a shift before exporting by shift.');
          return;
        }
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
    if (dashboard?.shiftSummary.shiftCode && exportShift === '') {
      setExportShift(dashboard.shiftSummary.shiftCode);
    }
  }, [dashboard?.shiftSummary.shiftCode, exportShift]);

  useEffect(() => {
    if (dashboard?.shiftSummary.prodDate) {
      setExportDate(dashboard.shiftSummary.prodDate);
    }
  }, [dashboard?.shiftSummary.prodDate]);

  const dashFilters = useMemo(() => ({
    machine: machineFilter !== 'ALL' ? machineFilter : undefined,
    shift: shiftFilter !== 'ALL' ? shiftFilter : undefined,
    search: debouncedSearch || undefined,
    subProcess: processFilter !== 'ALL' ? processFilter : undefined,
  }), [machineFilter, shiftFilter, debouncedSearch, processFilter]);

  useEffect(() => {
    if (activeTab !== 'rejected') return;
    setRejectedLoading(true);
    void liveService
      .getRejectedOrders({
        date: exportDate || undefined,
        shiftCode: exportShift || undefined,
        machine: dashFilters.machine,
        limit: 100,
      })
      .then((res) => {
        const q = debouncedSearch.toLowerCase();
        const rows = q
          ? res.orders.filter((r) =>
            `${r.batchNumber} ${r.coilNo ?? ''} ${r.reason}`.toLowerCase().includes(q)
            && matchesProcessFilter(r.subProcess, processFilter))
          : res.orders.filter((r) => matchesProcessFilter(r.subProcess, processFilter));
        setRejectedOrders(rows);
      })
      .catch(() => setRejectedOrders([]))
      .finally(() => setRejectedLoading(false));
  }, [activeTab, exportDate, exportShift, dashFilters.machine, debouncedSearch, processFilter]);

  useEffect(() => {
    if (activeTab !== 'completed') return;
    setCompletedLoading(true);
    const qs = new URLSearchParams();
    if (exportDate) qs.set('date', exportDate);
    if (exportShift) qs.set('shiftCode', exportShift);
    if (dashFilters.machine) qs.set('machine', dashFilters.machine);
    
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiClient.get<any[]>(`/6hi/orders/completed?${qs.toString()}`)
      .then((res) => {
        const q = debouncedSearch.toLowerCase();
        let rows = res;
        if (q) {
          rows = rows.filter((r) => 
            `${r.batchNumber} ${r.coilNo ?? ''} ${r.customer ?? ''}`.toLowerCase().includes(q)
          );
        }
        rows = rows.filter((r) => matchesProcessFilter(r.subProcess, processFilter));
        setCompletedOrders(rows);
      })
      .catch((err) => console.error('Failed to load completed orders', err))
      .finally(() => setCompletedLoading(false));
  }, [activeTab, exportDate, exportShift, dashFilters.machine, debouncedSearch, processFilter]);

  const loadDashboard = useCallback(async () => {
    try {
      const dash = await liveService.getMachineHeadDashboard(dashFilters);
      const fingerprint = jsonFingerprint(dash);
      if (fingerprint !== prevDashboardFpRef.current) {
        prevDashboardFpRef.current = fingerprint;
        setDashboard(dash);
      }
      setDashError(null);
    } catch (err: unknown) {
      setDashError((err as Error)?.message ?? 'Unable to load machine dashboard');
    }
  }, [dashFilters]);

  useEffect(() => {
    void loadDashboard();
    const id = setInterval(() => void loadDashboard(), LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [loadDashboard]);

  const machines = useMemo(() => {
    const all = (snapshot?.machines ?? []).filter((m) => m.status !== 'OFFLINE');
    const plantWide = role === 'PLANT_HEAD' || role === 'ADMIN' || role === 'SUPERVISOR';
    if (plantWide) return all;
    if (assignedMachines.length === 0) return [];
    const allowed = new Set(assignedMachines);
    return all.filter((m) => allowed.has(m.machineCode));
  }, [snapshot?.machines, assignedMachines, role]);

  const visibleMachineAccess = assignedMachines;
  // Server already applies machine/search/subProcess — lists are API results.
  const filteredQueue = useMemo(() => {
    return (dashboard?.orderQueue ?? []).filter((o) => ACTIVE_ORDER_STATUSES.has(o.status));
  }, [dashboard?.orderQueue]);
  const filteredProduction = dashboard?.productionHistory ?? [];
  const stoppageCategories = useMemo(
    () => [...new Set((dashboard?.stoppages ?? []).map((s) => s.category).filter(Boolean))].sort(),
    [dashboard?.stoppages],
  );
  const filteredStoppages = useMemo(
    () => (dashboard?.stoppages ?? []).filter(
      (s) => stoppageReason === 'ALL' || s.category === stoppageReason,
    ),
    [dashboard?.stoppages, stoppageReason],
  );
  const filteredRejected = rejectedOrders;
  const filteredOperatorActivity = dashboard?.operatorActivity ?? [];
  const filteredHandover = useMemo(() => {
    const rows = [
      ...(dashboard?.handoverOverview?.pending ?? []),
      ...(dashboard?.handoverOverview?.recent ?? []),
    ];
    return [...new Map(rows.map((h) => [h.handoverId, h])).values()];
  }, [dashboard?.handoverOverview]);

  const processFilterTabs = useMemo(() => (
    ['ALL', 'ROLLING', 'SKIN_PASS'] as ProcessFilter[]
  ).map((id) => ({ id, label: formatProcessFilterLabel(id) })), []);

  const openMachineDetail = useCallback((machineCode: string) => {
    const card = machines.find((m) => m.machineCode === machineCode);
    setMachineModalCode(machineCode);
    setMachineModalData(card);
  }, [machines]);

  useEffect(() => {
    if (!machineModalCode) return;
    const card = machines.find((m) => m.machineCode === machineModalCode);
    if (card) setMachineModalData(card);
  }, [machines, machineModalCode]);

  const selectOrder = useCallback((row: LiveOrderRow) => {
    setSelectedOrder(row);
  }, []);

  const handleDelete = useCallback(async () => {
    if (!selectedOrder) return;
    const confirmed = window.confirm(
      `Delete order ${displayMotherCoilId(selectedOrder)}?\n\nThis removes the production record. The PPC plan entry remains. This cannot be undone.`,
    );
    if (!confirmed) return;
    setDeleteBusy(true);
    try {
      await deleteOrder(selectedOrder.batchNumber);
      invalidateAfterWrite({ batchNumber: selectedOrder.batchNumber });
      setSelectedOrder(null);
      setDetailOpen(false);
      await loadDashboard();
      void refresh();
    } catch (err: unknown) {
      alert((err as Error)?.message ?? 'Delete failed');
    } finally {
      setDeleteBusy(false);
    }
  }, [selectedOrder, loadDashboard, refresh]);

  const handleReinstate = useCallback(async () => {
    if (!selectedOrder) return;
    const confirmed = window.confirm(
      `Move order ${displayMotherCoilId(selectedOrder)} back to Preparing?\n\nThis clears the hold and returns the order to the active queue.`,
    );
    if (!confirmed) return;
    setReinstateBusy(true);
    try {
      const machine = selectedOrder.machineCode?.toUpperCase();
      const qs = machine ? `?machine=${encodeURIComponent(machine)}` : '';
      await postQueued(
        `/6hi/orders/${encodeURIComponent(selectedOrder.batchNumber)}/reinstate${qs}`,
        {},
        `6hi-order:${selectedOrder.batchNumber}`,
      );
      setSelectedOrder(null);
      setDetailOpen(false);
      await loadDashboard();
      void refresh();
    } catch (err: unknown) {
      alert((err as Error)?.message ?? 'Reinstate failed');
    } finally {
      setReinstateBusy(false);
    }
  }, [selectedOrder, loadDashboard, refresh]);

  const orderRowClass = (batchNumber: string) =>
    [
      'px-4 py-3 flex justify-between gap-2 items-center transition-colors cursor-pointer text-sm',
      selectedOrder?.batchNumber === batchNumber ? 'bg-primary/10' : 'hover:bg-secondary',
    ].join(' ');

  const showOrderPanel = ORDER_TABS.includes(activeTab);

  if (loading && !snapshot) {
    return (
      <MachineHeadShell
        title={role === 'SUPERVISOR' ? 'Supervisor Live Dashboard' : 'Machine Dashboard'}
        subtitle="Loading…"
        fillViewport
      >
        <div className="py-16 text-center text-muted-foreground text-sm">Loading…</div>
      </MachineHeadShell>
    );
  }

  const kpis = snapshot?.kpis;

  const renderTabContent = () => {
    if (!dashboard && activeTab !== 'overview') {
      return <p className="text-sm text-muted-foreground py-8 text-center">Loading dashboard data…</p>;
    }

    switch (activeTab) {
      case 'overview':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
            <Panel className="lg:col-span-2">
              <PanelHeader title="Your Machines" />
              <PanelBody empty={machines.length === 0} emptyLabel="No machines in scope">
                <div className="p-4">
                  <MachineStatusBoard machines={machines} onSelect={openMachineDetail} />
                </div>
              </PanelBody>
            </Panel>

            {dashboard && (
              <>
                <Panel>
                  <PanelHeader title="Shift Summary" />
                  <dl className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-border/70">
                    <StatCell label="Prod Date" value={dashboard.shiftSummary.prodDate} mono />
                    <StatCell label="Shift" value={dashboard.shiftSummary.shiftCode} />
                    <StatCell label="Target MT" value={dashboard.shiftSummary.targetMt} mono />
                    <StatCell label="Live Queue MT" value={dashboard.shiftSummary.queuedMt} mono />
                    <StatCell
                      label="Total MT"
                      value={dashboard.shiftSummary.totalProdMt ?? 0}
                      mono
                    />
                    <StatCell
                      label="Completed MT"
                      value={dashboard.shiftSummary.completedProdMt ?? 0}
                      mono
                    />
                    <StatCell label="In Progress MT" value={dashboard.shiftSummary.inProgressMt ?? 0} mono />
                    <StatCell
                      label="Shift Orders"
                      value={`${dashboard.shiftSummary.orderCount} · ${dashboard.shiftSummary.completedOrderCount} done`}
                    />
                  </dl>
                </Panel>

                <Panel>
                  <PanelHeader title="Runtime Utilization (24h)" />
                  <PanelBody empty={dashboard.runtimeUtilization.length === 0}>
                    <div className="grid grid-cols-2 gap-3 p-4">
                      {dashboard.runtimeUtilization.map((u) => {
                        const pct = Math.max(0, Math.min(100, Number(u.runtimeUtilizationPct) || 0));
                        return (
                          <div key={u.machineCode} className="rounded-xl border border-border bg-secondary/40 p-3">
                            <p className="z-eyebrow truncate">{u.machineName}</p>
                            <p className="text-2xl font-mono font-bold text-primary mt-1 leading-none">{u.runtimeUtilizationPct}%</p>
                            <div className="mt-2 h-1.5 w-full rounded-full bg-border/70 overflow-hidden">
                              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </PanelBody>
                </Panel>
              </>
            )}
          </div>
        );

      case 'orders':
        return (
          <Panel className="h-full flex flex-col">
            <PanelHeader title="Running & Preparing Orders" />
            <PanelBody empty={filteredQueue.length === 0} emptyLabel="No active orders found">
              <div className="min-w-full inline-block align-middle">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Order / Coil</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Customer</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Process</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Weight</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-transparent divide-y divide-border">
                    {filteredQueue.map((o) => (
                      <tr
                        key={o.batchNumber}
                        className="hover:bg-secondary/50 cursor-pointer transition-colors"
                        onClick={() => selectOrder(liveRowFromQueue(o))}
                        onKeyDown={(e) => e.key === 'Enter' && selectOrder(liveRowFromQueue(o))}
                        role="button"
                        tabIndex={0}
                      >
                        <td className="px-4 py-3 text-sm">
                          <OrderIdentityDisplay order={o} size="sm" />
                        </td>
                        <td className="px-4 py-3 text-sm truncate max-w-[12rem] text-muted-foreground">{o.customer || '—'}</td>
                        <td className="px-4 py-3 text-sm font-medium">
                          {o.subProcess === 'SKIN_PASS' ? 'Skin Pass' : o.subProcess === 'ROLLING' ? 'Rolling' : o.currentProcess}
                        </td>
                        <td className="px-4 py-3 text-sm font-mono tabular-nums">{o.weightMt} MT</td>
                        <td className="px-4 py-3 text-sm">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            o.status === 'RUNNING' || o.status === 'IN_PROGRESS' 
                              ? 'bg-success/10 text-success' 
                              : 'bg-primary/10 text-primary'
                          }`}>
                            {formatOrderStatusLabel(o.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PanelBody>
          </Panel>
        );

      case 'production':
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-0">
            <Panel>
              <PanelHeader title="Production History · This Shift" />
              <PanelBody empty={filteredProduction.length === 0}>
                <ul className="divide-y divide-border text-xs">
                  {filteredProduction.map((h) => (
                    <li
                      key={`${h.batchNumber}-${h.completedAt}`}
                      className={orderRowClass(h.batchNumber)}
                      onClick={() => dashboard && selectOrder(liveRowFromHistory(h, dashboard))}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="min-w-0 flex-1">
                        <OrderIdentityDisplay order={identityFromRow(h)} size="sm" />
                      </span>
                      <span className="font-mono">{h.weightMt} MT</span>
                      <span className="text-muted-foreground">{formatPlantDateTime(h.completedAt)}</span>
                    </li>
                  ))}
                </ul>
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title="Operator Activity" />
              <PanelBody empty={filteredOperatorActivity.length === 0}>
                <ul className="divide-y divide-border text-xs">
                  {filteredOperatorActivity.map((a) => (
                    <li
                      key={`${a.batchNumber}-${a.operatorName}`}
                      className={orderRowClass(a.batchNumber)}
                      onClick={() => {
                        if (!dashboard) return;
                        const match = dashboard.orderQueue.find((q) => q.batchNumber === a.batchNumber);
                        const id = identityFromRow(a);
                        selectOrder(match ?? {
                          batchNumber: a.batchNumber,
                          customer: '—',
                          grade: '—',
                          machineCode: a.machineCode ?? '—',
                          machineName: a.machineCode ?? '—',
                          currentProcess: a.subProcess === 'SKIN_PASS' ? 'Skin Pass' : 'Rolling',
                          operatorName: a.operatorName,
                          status: a.status as LiveOrderRow['status'],
                          weightMt: 0,
                          coilNo: id.coilNo,
                          motherCoil: id.motherCoil,
                          slitId: id.slitId,
                        });
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="font-semibold">{a.operatorName}</span>
                      <span className="min-w-0 flex-1">
                        <OrderIdentityDisplay order={identityFromRow(a)} size="sm" />
                      </span>
                      <span className="text-muted-foreground">{formatOrderStatusLabel(a.status)}</span>
                    </li>
                  ))}
                </ul>
              </PanelBody>
            </Panel>
          </div>
        );

      case 'stoppages':
        return (
          <Panel className="h-full flex flex-col">
            <PanelHeader title="Stoppage History · This Shift">
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                Reason
                <select
                  value={stoppageReason}
                  onChange={(e) => setStoppageReason(e.target.value)}
                  className="block rounded-lg border border-border bg-white px-2 py-1 text-sm text-foreground"
                >
                  <option value="ALL">All reasons</option>
                  {stoppageCategories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
            </PanelHeader>
            <PanelBody empty={filteredStoppages.length === 0} emptyLabel="No stoppages for this shift">
              <div className="min-w-full inline-block align-middle">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Machine</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Order</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Reason</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Start Time</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Duration</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody className="bg-transparent divide-y divide-border">
                    {filteredStoppages.map((s) => {
                      const isActive = s.status === 'ACTIVE';
                      return (
                        <tr
                          key={`${s.batchNumber}-${s.startAt}`}
                          className="hover:bg-secondary/50 cursor-pointer transition-colors"
                          onClick={() => {
                            if (!dashboard) return;
                            const match = dashboard.orderQueue.find((q) => q.batchNumber === s.batchNumber);
                            const id = identityFromRow(s);
                            selectOrder(match ?? {
                              batchNumber: s.batchNumber,
                              customer: '—',
                              grade: '—',
                              machineCode: s.machineCode,
                              machineName: s.machineCode,
                              currentProcess: '—',
                              status: 'STOPPAGE',
                              weightMt: 0,
                              coilNo: id.coilNo,
                              motherCoil: id.motherCoil,
                              slitId: id.slitId,
                            });
                          }}
                        >
                          <td className="px-4 py-3 text-sm font-mono font-bold">{s.machineCode}</td>
                          <td className="px-4 py-3 text-sm">
                            <OrderIdentityDisplay order={identityFromRow(s)} size="sm" />
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <div className={`font-medium ${isActive ? 'text-destructive' : 'text-foreground'}`}>{s.category}</div>
                            {s.remarks && <div className="text-xs text-muted-foreground">{s.remarks}</div>}
                          </td>
                          <td className="px-4 py-3 text-sm font-mono tabular-nums text-muted-foreground">
                            {s.startAt ? formatPlantDateTime(s.startAt) : '—'}
                          </td>
                          <td className={`px-4 py-3 text-sm font-mono tabular-nums ${isActive ? 'text-warning' : 'text-muted-foreground'}`}>
                            <StoppageDurationCell
                              startAt={s.startAt}
                              active={isActive}
                              durationMin={s.durationMin}
                            />
                          </td>
                          <td className="px-4 py-3 text-sm font-medium">
                            {isActive ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-destructive/10 text-destructive">
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                                Ended{s.endAt ? ` · ${formatPlantDateTime(s.endAt)}` : ''}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </PanelBody>
          </Panel>
        );

      case 'rejected':
        return (
          <Panel className="h-full flex flex-col">
            <div className="px-4 py-3 border-b border-border/70 z-tint space-y-2 shrink-0">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs font-medium text-muted-foreground">
                  Filter date
                  <input
                    type="date"
                    value={exportDate}
                    onChange={(e) => setExportDate(e.target.value)}
                    className="mt-1 block rounded-lg border border-border bg-white px-2 py-1 text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Shift
                  <select
                    value={exportShift}
                    onChange={(e) => setExportShift(e.target.value)}
                    className="mt-1 block rounded-lg border border-border bg-white px-2 py-1 text-sm"
                  >
                    <option value="">All shifts</option>
                    {['A', 'B', 'C'].map((s) => (
                      <option key={s} value={s}>Shift {s}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex gap-2 justify-end">
                <ZButton variant="outline" size="sm" onClick={() => handleExportRejected('day')} className="gap-1">
                  <Download className="w-3.5 h-3.5" /> Day
                </ZButton>
                <ZButton variant="outline" size="sm" onClick={() => handleExportRejected('shift')} className="gap-1">
                  <Download className="w-3.5 h-3.5" /> Shift
                </ZButton>
              </div>
            </div>
            <PanelBody empty={!rejectedLoading && filteredRejected.length === 0} emptyLabel={rejectedLoading ? 'Loading held orders…' : 'No orders on hold'}>
              <ul className="divide-y divide-border text-xs">
                {filteredRejected.map((r) => (
                  <li
                    key={`${r.batchNumber}-${r.rejectionTime}`}
                    className={`${orderRowClass(r.batchNumber)} flex-col items-stretch`}
                    onClick={() => selectOrder(liveRowFromRejected(r))}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="flex justify-between w-full gap-2">
                      <OrderIdentityDisplay order={identityFromRow(r)} size="sm" className="min-w-0" />
                      <span className="font-mono font-bold text-destructive shrink-0">{r.weightMt} MT</span>
                    </div>
                    <div className="flex gap-2 items-start mt-1 w-full">
                      <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" />
                      <div>
                        <p>{r.reason}</p>
                        <p className="text-muted-foreground mt-0.5">
                          Held by {r.rejectedBy} · {formatPlantDateTime(r.rejectionTime)}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </PanelBody>
          </Panel>
        );

      case 'completed':
        return (
          <Panel className="h-full flex flex-col">
            <div className="px-4 py-3 border-b border-border/70 z-tint space-y-2 shrink-0">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs font-medium text-muted-foreground">
                  Filter date
                  <input
                    type="date"
                    value={exportDate}
                    onChange={(e) => setExportDate(e.target.value)}
                    className="mt-1 block rounded-lg border border-border bg-white px-2 py-1 text-sm font-mono tabular-nums"
                  />
                </label>
                <label className="text-xs font-medium text-muted-foreground">
                  Shift
                  <select
                    value={exportShift}
                    onChange={(e) => setExportShift(e.target.value)}
                    className="mt-1 block rounded-lg border border-border bg-white px-2 py-1 text-sm"
                  >
                    <option value="">All shifts</option>
                    {['A', 'B', 'C'].map((s) => (
                      <option key={s} value={s}>Shift {s}</option>
                    ))}
                  </select>
                </label>
              </div>
              {dashboard && (
                <dl className="flex flex-wrap gap-x-6 gap-y-1 pt-1">
                  <div className="flex items-baseline gap-1.5">
                    <dt className="text-xs font-medium text-muted-foreground">Completed this shift</dt>
                    <dd className="text-sm font-bold font-mono tabular-nums text-foreground">
                      {completedLoading
                        ? dashboard.shiftSummary.completedOrderCount
                        : completedOrders.length}
                    </dd>
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <dt className="text-xs font-medium text-muted-foreground">Completed MT</dt>
                    <dd className="text-sm font-bold font-mono tabular-nums text-foreground">
                      {(completedLoading
                        ? (dashboard.shiftSummary.completedProdMt ?? 0)
                        : completedOrders.reduce((s, o) => s + (Number(o.weightMt) || 0), 0)
                      ).toFixed(1)} MT
                    </dd>
                  </div>
                </dl>
              )}
            </div>
            <PanelBody empty={!completedLoading && completedOrders.length === 0} emptyLabel={completedLoading ? 'Loading completed orders…' : 'No completed orders'}>
              <div className="min-w-full inline-block align-middle">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Order / Coil</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Machine</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Customer</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Weight</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Completed At</th>
                    </tr>
                  </thead>
                  <tbody className="bg-transparent divide-y divide-border">
                    {completedOrders.map((o) => (
                      <tr
                        key={o.batchNumber}
                        className="hover:bg-secondary/50 cursor-pointer transition-colors"
                        onClick={() => {
                          const id = identityFromRow(o);
                          selectOrder({
                            batchNumber: o.batchNumber,
                            customer: o.customer ?? '—',
                            grade: o.grade ?? '—',
                            machineCode: o.machineCode ?? '—',
                            machineName: o.machineName ?? o.machineCode ?? '—',
                            currentProcess: o.subProcess === 'SKIN_PASS' ? 'Skin Pass' : 'Rolling',
                            operatorName: o.operatorName,
                            status: 'COMPLETED',
                            weightMt: o.weightMt,
                            coilNo: id.coilNo,
                            motherCoil: id.motherCoil,
                            slitId: id.slitId,
                          });
                        }}
                      >
                        <td className="px-4 py-3 text-sm">
                          <OrderIdentityDisplay order={identityFromRow(o)} size="sm" />
                        </td>
                        <td className="px-4 py-3 text-sm font-mono font-bold">{o.machineCode ?? '—'}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground truncate max-w-[12rem]">{o.customer}</td>
                        <td className="px-4 py-3 text-sm font-mono tabular-nums font-bold">{o.weightMt} MT</td>
                        <td className="px-4 py-3 text-sm font-mono tabular-nums text-muted-foreground">{o.prodEndAt ? formatPlantDateTime(o.prodEndAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </PanelBody>
          </Panel>
        );

      case 'handover':
        return (
          <Panel className="h-full">
            <PanelHeader
              title={
                dashboard?.shiftSummary
                  ? `Shift Handover · ${dashboard.shiftSummary.prodDate} · Shift ${dashboard.shiftSummary.shiftCode}`
                  : 'Shift Handover Logs'
              }
            />
            <PanelBody empty={filteredHandover.length === 0}>
              <ul className="divide-y divide-border text-xs">
                {filteredHandover.map((h) => (
                  <li key={h.handoverId} className="px-4 py-3 hover:bg-secondary/50">
                    <div className="flex justify-between mb-1 gap-2">
                      <span className="font-bold">{h.machineCode}</span>
                      <span className="text-muted-foreground font-mono shrink-0">
                        {h.prodDate ? `${h.prodDate} · ` : ''}Shift {h.outgoingShiftCode} → {h.incomingShiftCode}
                        {h.status === 'PENDING' ? ' · Pending' : ''}
                        {h.status === 'AUTO_COMPLETED' || h.createdByBoundary ? ' · Auto / system' : ''}
                      </span>
                    </div>
                    <p className="text-muted-foreground mb-1">
                      Out: {h.outgoingUsername ?? '—'}
                      {' · '}
                      In: {h.incomingUsername ?? (h.status === 'PENDING' ? 'Awaiting accept' : '—')}
                    </p>
                    {h.batchNumber ? (
                      <div className="mb-1">
                        <OrderIdentityDisplay order={identityFromRow({
                          batchNumber: h.batchNumber,
                          motherCoil: h.motherCoil,
                          coilNo: h.coilNo,
                          slitId: h.slitId,
                        })} size="sm" />
                      </div>
                    ) : (
                      <p className="text-muted-foreground">Machine handover</p>
                    )}
                    {h.subProcess && (
                      <p className="text-muted-foreground">
                        {h.subProcess === 'SKIN_PASS' ? 'Skin Pass' : 'Cold Rolling'}
                      </p>
                    )}
                    <p className="text-muted-foreground">
                      Start {formatPlantDateTime(h.shiftStartAt ?? h.createdAt)}
                      {h.shiftEndAt ? ` · End ${formatPlantDateTime(h.shiftEndAt)}` : ''}
                      {h.shiftDurationMinutes != null ? ` · ${h.shiftDurationLabel ?? formatDuration(h.shiftDurationMinutes)}` : ''}
                    </p>
                    {h.remarks && (
                      <p className="mt-1 text-foreground/80 whitespace-pre-wrap">{h.remarks}</p>
                    )}
                  </li>
                ))}
              </ul>
            </PanelBody>
          </Panel>
        );

      default:
        return null;
    }
  };

  return (
    <MachineHeadShell
      title={role === 'SUPERVISOR' ? 'Supervisor Live Dashboard' : 'Machine Dashboard'}
      subtitle={
        role === 'SUPERVISOR'
          ? `Plant-wide oversight${dashboard?.shiftSummary ? ` · ${dashboard.shiftSummary.prodDate} · Shift ${dashboard.shiftSummary.shiftCode}` : ''}`
          : assignedMachines.length > 0
            ? `Assigned: ${visibleMachineAccess.join(', ') || '—'}${dashboard?.shiftSummary ? ` · ${dashboard.shiftSummary.prodDate} · Shift ${dashboard.shiftSummary.shiftCode}` : ''}`
            : 'No machines assigned — contact Plant Head'
      }
      onRefresh={() => { void refresh(); void loadDashboard(); }}
      fillViewport
    >
      <div className="flex flex-col flex-1 min-h-0 gap-3">
        {(error || dashError) && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive shrink-0">
            {error ?? dashError}
          </div>
        )}

        {assignedMachines.length === 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning shrink-0">
            No machines assigned to your profile. Contact Plant Head for access.
          </div>
        )}

        {assignedMachines.length > 0 && visibleMachineAccess.length === 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning shrink-0">
            Assigned machines are currently disabled. Contact an admin to enable them.
          </div>
        )}

        {kpis && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 shrink-0">
            <CommandMetric label="Running" value={String(kpis.runningMachines)} tone="success" />
            <CommandMetric label="Idle" value={String(kpis.idleMachines)} tone="muted" />
            <CommandMetric label="Stoppages" value={String(kpis.currentStoppages)} tone="warning" />
            <CommandMetric label="Active Orders" value={String(kpis.activeOrders)} tone="info" />
          </div>
        )}

        <div className="z-card shrink-0 flex flex-col gap-2.5 p-2.5">
          <div className="overflow-x-auto">
            <ZPillTabs
              tabs={DASHBOARD_TABS}
              activeId={activeTab}
              onChange={(id) => setActiveTab(id as DashboardTab)}
              className="min-w-max"
            />
          </div>

          {PROCESS_FILTER_TABS.includes(activeTab) && (
            <div className="overflow-x-auto flex flex-wrap gap-2 items-center border-t border-border/60 pt-2.5">
              <ZPillTabs
                tabs={processFilterTabs}
                activeId={processFilter}
                onChange={(id) => setProcessFilter(id as ProcessFilter)}
                className="min-w-max"
              />
              <input
                type="search"
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                placeholder="Search batch, coil, customer…"
                className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm min-w-[12rem] flex-1 max-w-xs"
                aria-label="Search orders"
              />
              <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                Shift
                <select
                  value={shiftFilter}
                  onChange={(e) => setShiftFilter(e.target.value)}
                  className="block rounded-lg border border-border bg-white px-2 py-1 text-sm font-medium text-foreground"
                >
                  <option value="ALL">All Shifts</option>
                  {['A', 'B', 'C'].map((s) => (
                    <option key={s} value={s}>Shift {s}</option>
                  ))}
                </select>
              </label>
              {machines.length > 0 && (
                <label className="ml-auto flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  Machine
                  <select
                    value={machineFilter}
                    onChange={(e) => setMachineFilter(e.target.value)}
                    className="block rounded-lg border border-border bg-white px-2 py-1 text-sm font-mono font-bold text-foreground"
                  >
                    <option value="ALL">All Machines</option>
                    {machines.map((m) => (
                      <option key={m.machineCode} value={m.machineCode}>{m.machineCode}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}
        </div>

        <div
          className={[
            'flex-1 min-h-0 grid gap-4',
            showOrderPanel ? 'xl:grid-cols-[1fr_minmax(280px,320px)]' : 'grid-cols-1',
          ].join(' ')}
        >
          <div className="min-h-0 overflow-y-auto pr-1">
            {renderTabContent()}
          </div>

          {showOrderPanel && (
            <aside className="hidden xl:block self-start sticky top-0 w-full max-h-full overflow-y-auto">
              <MachineHeadOrderSidePanel
                order={selectedOrder}
                onViewDetails={() => setDetailOpen(true)}
                onDelete={() => void handleDelete()}
                deleteBusy={deleteBusy}
                onReinstate={() => void handleReinstate()}
                reinstateBusy={reinstateBusy}
              />
            </aside>
          )}
        </div>

        {showOrderPanel && (
          <div className="xl:hidden shrink-0 max-h-[40vh] overflow-hidden">
            <MachineHeadOrderSidePanel
              order={selectedOrder}
              onViewDetails={() => setDetailOpen(true)}
              onDelete={() => void handleDelete()}
              deleteBusy={deleteBusy}
              onReinstate={() => void handleReinstate()}
              reinstateBusy={reinstateBusy}
            />
          </div>
        )}
      </div>

      {exportJobId && (
        <ExportProgressModal jobId={exportJobId} onClose={() => setExportJobId(null)} />
      )}

      <MachineHeadOrderDetailModal
        batchNumber={selectedOrder?.batchNumber ?? null}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
      />

      <MachineDetailModal
        open={machineModalCode != null}
        machineCode={machineModalCode}
        machineData={machineModalData}
        processFilter={processFilter}
        onClose={() => {
          setMachineModalCode(null);
          setMachineModalData(undefined);
        }}
      />
    </MachineHeadShell>
  );
}
