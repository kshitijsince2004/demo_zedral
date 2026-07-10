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
import { liveService } from '../../lib/liveService';
import { useAuthStore } from '../../lib/authStore';
import { ZButton } from '../../components/primitives/ZButton';
import { Download, AlertTriangle } from 'lucide-react';
import { OrderIdentityDisplay } from '../../components/orders/OrderIdentityDisplay';
import { coilNumberOf } from '../../components/orders/OrderIdentityDisplay';
import { reportingService } from '../../lib/reportingService';
import { ExportProgressModal } from '../../components/export/ExportProgressModal';
import { currentPlantDate, formatPlantDateTime } from '../../lib/dateFormat';
import { apiClient } from '../../lib/apiClient';
import { jsonFingerprint } from '../../lib/silentRefresh';
import { formatOrderStatusLabel, formatProcessFilterLabel } from '../../lib/orderLabels';
import type { MachineStatusCard } from '@m1/shared-validation';

type DashboardTab = 'overview' | 'orders' | 'production' | 'stoppages' | 'rejected' | 'handover';
type ProcessFilter = 'ALL' | 'ROLLING' | 'SKIN_PASS';

const ORDER_TABS: DashboardTab[] = ['orders', 'production', 'stoppages', 'rejected'];
const PROCESS_FILTER_TABS: DashboardTab[] = [...ORDER_TABS, 'handover'];

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

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-0 ${className}`}>
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
    <div className="px-3 py-2.5">
      <dt className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 text-sm font-bold text-foreground ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function liveRowFromQueue(o: MachineHeadDashboardData['orderQueue'][0]): LiveOrderRow {
  return o;
}

function liveRowFromHistory(h: MachineHeadDashboardData['productionHistory'][0], dashboard: MachineHeadDashboardData): LiveOrderRow {
  const match = dashboard.orderQueue.find((q) => q.batchNumber === h.batchNumber);
  return match ?? {
    batchNumber: h.batchNumber,
    customer: '—',
    grade: '—',
    machineCode: '—',
    machineName: '—',
    currentProcess: '—',
    status: 'COMPLETED',
    weightMt: h.weightMt,
    coilNo: h.batchNumber,
  };
}

function liveRowFromRejected(r: NonNullable<MachineHeadDashboardData['rejectedOrders']>[0] | import('@m1/shared-validation').RejectedOrderRow): LiveOrderRow {
  return {
    batchNumber: r.batchNumber,
    customer: '—',
    grade: '—',
    machineCode: r.machineCode,
    machineName: r.machineCode,
    currentProcess: r.subProcess === 'SKIN_PASS' ? 'Skin Pass' : 'Rolling',
    status: 'REJECTED',
    weightMt: r.weightMt,
    coilNo: ('coilNo' in r && r.coilNo) ? r.coilNo : r.batchNumber,
    shiftCode: r.shiftCode,
  };
}

function tabLabel(base: string, count?: number) {
  return count != null && count > 0 ? `${base} (${count})` : base;
}

export function MachineHeadDashboard() {
  const machineAccess = useAuthStore((s) => s.machineAccess);
  const { snapshot, loading, error, refresh } = useLiveSnapshot();
  const [dashboard, setDashboard] = useState<MachineHeadDashboardData | null>(null);
  const [dashError, setDashError] = useState<string | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportDate, setExportDate] = useState(currentPlantDate());
  const [exportShift, setExportShift] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<LiveOrderRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<DashboardTab>('overview');
  const [rejectedOrders, setRejectedOrders] = useState<NonNullable<MachineHeadDashboardData['rejectedOrders']>>([]);
  const [rejectedLoading, setRejectedLoading] = useState(false);
  const [processFilter, setProcessFilter] = useState<ProcessFilter>('ALL');
  const [machineModalCode, setMachineModalCode] = useState<string | null>(null);
  const [machineModalData, setMachineModalData] = useState<MachineStatusCard | undefined>();
  const prevDashboardFpRef = useRef('');

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
    if (dashboard?.shiftSummary.prodDate) {
      setExportDate(dashboard.shiftSummary.prodDate);
    }
  }, [dashboard?.shiftSummary.shiftCode, dashboard?.shiftSummary.prodDate]);

  useEffect(() => {
    if (activeTab !== 'rejected') return;
    setRejectedLoading(true);
    void liveService
      .getRejectedOrders({
        date: exportDate,
        shiftCode: exportShift || dashboard?.shiftSummary.shiftCode,
        limit: 100,
      })
      .then((res) => setRejectedOrders(res.orders))
      .catch(() => setRejectedOrders(dashboard?.rejectedOrders ?? []))
      .finally(() => setRejectedLoading(false));
  }, [activeTab, exportDate, exportShift, dashboard?.shiftSummary.shiftCode, dashboard?.rejectedOrders]);

  const loadDashboard = useCallback(async () => {
    try {
      const dash = await liveService.getMachineHeadDashboard();
      const fingerprint = jsonFingerprint(dash);
      if (fingerprint !== prevDashboardFpRef.current) {
        prevDashboardFpRef.current = fingerprint;
        setDashboard(dash);
      }
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

  const tabCount = useCallback((total: number, filtered: number) => (
    processFilter === 'ALL' ? total : filtered
  ), [processFilter]);

  const filteredQueue = useMemo(
    () => dashboard?.orderQueue.filter((o) => matchesProcessFilter(o.subProcess, processFilter)) ?? [],
    [dashboard?.orderQueue, processFilter],
  );
  const filteredProduction = useMemo(
    () => dashboard?.productionHistory.filter((h) => matchesProcessFilter(h.subProcess, processFilter)) ?? [],
    [dashboard?.productionHistory, processFilter],
  );
  const filteredStoppages = useMemo(
    () => dashboard?.stoppages.filter((s) => matchesProcessFilter(s.subProcess, processFilter)) ?? [],
    [dashboard?.stoppages, processFilter],
  );
  const filteredRejected = useMemo(
    () => rejectedOrders.filter((r) => matchesProcessFilter(r.subProcess, processFilter)),
    [rejectedOrders, processFilter],
  );
  const filteredOperatorActivity = useMemo(
    () => dashboard?.operatorActivity.filter((a) => {
      const match = dashboard.orderQueue.find((q) => q.batchNumber === a.batchNumber);
      return matchesProcessFilter(match?.subProcess ?? a.subProcess, processFilter);
    }) ?? [],
    [dashboard?.operatorActivity, dashboard?.orderQueue, processFilter],
  );
  const filteredHandover = useMemo(() => {
    const rows = [
      ...(dashboard?.handoverOverview?.pending ?? []),
      ...(dashboard?.handoverOverview?.recent ?? []),
    ];
    const unique = new Map(rows.map((h) => [h.handoverId, h]));
    return [...unique.values()].filter((h) => matchesProcessFilter(h.subProcess, processFilter, true));
  }, [dashboard?.handoverOverview, processFilter]);

  const tabs = useMemo(() => [
    { id: 'overview', label: 'Overview' },
    { id: 'orders', label: tabLabel('Orders', tabCount(dashboard?.orderQueue.length ?? 0, filteredQueue.length)) },
    { id: 'production', label: tabLabel('Production', tabCount(dashboard?.productionHistory.length ?? 0, filteredProduction.length)) },
    { id: 'stoppages', label: tabLabel('Stoppages', tabCount(dashboard?.stoppages.length ?? 0, filteredStoppages.length)) },
    { id: 'rejected', label: tabLabel('Order Hold', tabCount(dashboard?.rejectedOrderCount ?? dashboard?.rejectedOrders?.length ?? 0, filteredRejected.length)) },
    { id: 'handover', label: tabLabel('Handover', tabCount((dashboard?.handoverOverview?.recent.length ?? 0) + (dashboard?.handoverOverview?.pending.length ?? 0), filteredHandover.length)) },
  ], [dashboard, filteredQueue.length, filteredProduction.length, filteredStoppages.length, filteredRejected.length, filteredHandover.length, tabCount]);

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
      `Delete order ${coilNumberOf(selectedOrder)}?\n\nThis removes the production record. The PPC plan entry remains. This cannot be undone.`,
    );
    if (!confirmed) return;
    setDeleteBusy(true);
    try {
      await apiClient.delete(`/6hi/orders/${encodeURIComponent(selectedOrder.batchNumber)}`);
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

  const orderRowClass = (batchNumber: string) =>
    [
      'px-4 py-3 flex justify-between gap-2 items-center transition-colors cursor-pointer text-sm',
      selectedOrder?.batchNumber === batchNumber ? 'bg-primary/10' : 'hover:bg-secondary',
    ].join(' ');

  const showOrderPanel = ORDER_TABS.includes(activeTab);

  if (loading && !snapshot) {
    return (
      <MachineHeadShell title="Machine Dashboard" subtitle="Loading…" fillViewport>
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
              <div className="px-4 py-2 border-b border-border/60 bg-muted/20">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Your Machines</h3>
              </div>
              <PanelBody empty={machines.length === 0} emptyLabel="No machines in scope">
                <div className="p-4">
                  <MachineStatusBoard machines={machines} onSelect={openMachineDetail} />
                </div>
              </PanelBody>
            </Panel>

            {dashboard && (
              <>
                <Panel>
                  <div className="px-4 py-2 border-b border-border/60 bg-muted/20">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Shift Summary</h3>
                  </div>
                  <dl className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-border">
                    <StatCell label="Prod Date" value={dashboard.shiftSummary.prodDate} mono />
                    <StatCell label="Shift" value={dashboard.shiftSummary.shiftCode} />
                    <StatCell label="Target MT" value={dashboard.shiftSummary.targetMt} mono />
                    <StatCell label="Queued MT" value={dashboard.shiftSummary.queuedMt} mono />
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
                    <StatCell
                      label="Orders"
                      value={`${dashboard.shiftSummary.orderCount} q · ${dashboard.shiftSummary.completedOrderCount} done`}
                    />
                  </dl>
                </Panel>

                <Panel>
                  <div className="px-4 py-2 border-b border-border/60 bg-muted/20">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Runtime Utilization (24h)</h3>
                  </div>
                  <PanelBody empty={dashboard.runtimeUtilization.length === 0}>
                    <div className="grid grid-cols-2 gap-3 p-4">
                      {dashboard.runtimeUtilization.map((u) => (
                        <div key={u.machineCode} className="rounded-xl border border-border bg-secondary/30 p-3">
                          <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground truncate">{u.machineName}</p>
                          <p className="text-xl font-mono font-bold text-primary mt-1">{u.runtimeUtilizationPct}%</p>
                        </div>
                      ))}
                    </div>
                  </PanelBody>
                </Panel>
              </>
            )}
          </div>
        );

      case 'orders':
        return (
          <Panel className="h-full">
            <div className="px-4 py-2 border-b border-border/60 bg-muted/20 shrink-0">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Order Queue · Rolling + Skin Pass</h3>
            </div>
            <PanelBody empty={filteredQueue.length === 0}>
              <ul className="divide-y divide-border">
                {filteredQueue.map((o) => (
                  <li
                    key={o.batchNumber}
                    className={orderRowClass(o.batchNumber)}
                    onClick={() => selectOrder(liveRowFromQueue(o))}
                    onKeyDown={(e) => e.key === 'Enter' && selectOrder(liveRowFromQueue(o))}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="min-w-0 flex-1">
                      <OrderIdentityDisplay order={o} size="sm" />
                    </span>
                    <span className="text-muted-foreground truncate">{o.customer}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {o.subProcess === 'SKIN_PASS' ? 'Skin Pass' : o.subProcess === 'ROLLING' ? 'Rolling' : o.currentProcess}
                    </span>
                    <span className="text-[10px] font-bold uppercase shrink-0">{formatOrderStatusLabel(o.status)}</span>
                  </li>
                ))}
              </ul>
            </PanelBody>
          </Panel>
        );

      case 'production':
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-0">
            <Panel>
              <div className="px-4 py-2 border-b border-border/60 bg-muted/20">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Production History</h3>
              </div>
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
                        <OrderIdentityDisplay order={{ batchNumber: h.batchNumber, coilNo: h.batchNumber }} size="sm" />
                      </span>
                      <span className="font-mono">{h.weightMt} MT</span>
                      <span className="text-muted-foreground">{formatPlantDateTime(h.completedAt)}</span>
                    </li>
                  ))}
                </ul>
              </PanelBody>
            </Panel>
            <Panel>
              <div className="px-4 py-2 border-b border-border/60 bg-muted/20">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Operator Activity</h3>
              </div>
              <PanelBody empty={filteredOperatorActivity.length === 0}>
                <ul className="divide-y divide-border text-xs">
                  {filteredOperatorActivity.map((a) => (
                    <li
                      key={`${a.batchNumber}-${a.operatorName}`}
                      className={orderRowClass(a.batchNumber)}
                      onClick={() => {
                        if (!dashboard) return;
                        const match = dashboard.orderQueue.find((q) => q.batchNumber === a.batchNumber);
                        selectOrder(match ?? {
                          batchNumber: a.batchNumber,
                          customer: '—',
                          grade: '—',
                          machineCode: '—',
                          machineName: '—',
                          currentProcess: '—',
                          operatorName: a.operatorName,
                          status: a.status as LiveOrderRow['status'],
                          weightMt: 0,
                          coilNo: a.batchNumber,
                        });
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="font-semibold">{a.operatorName}</span>
                      <span className="font-mono font-bold">{a.batchNumber}</span>
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
          <Panel className="h-full">
            <div className="px-4 py-2 border-b border-border/60 bg-muted/20">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Breakdowns & Stoppages</h3>
            </div>
            <PanelBody empty={filteredStoppages.length === 0}>
              <ul className="divide-y divide-border text-xs">
                {filteredStoppages.map((s) => (
                  <li
                    key={`${s.batchNumber}-${s.startAt}`}
                    className={orderRowClass(s.batchNumber)}
                    onClick={() => {
                      if (!dashboard) return;
                      const match = dashboard.orderQueue.find((q) => q.batchNumber === s.batchNumber);
                      selectOrder(match ?? {
                        batchNumber: s.batchNumber,
                        customer: '—',
                        grade: '—',
                        machineCode: s.machineCode,
                        machineName: s.machineCode,
                        currentProcess: '—',
                        status: 'STOPPAGE',
                        weightMt: 0,
                        coilNo: s.batchNumber,
                      });
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="font-mono font-bold">{s.batchNumber}</span>
                    <span>{s.category}</span>
                    {s.remarks && <span className="text-muted-foreground truncate max-w-[12rem]">{s.remarks}</span>}
                    <span className="text-muted-foreground">{s.machineCode}</span>
                  </li>
                ))}
              </ul>
            </PanelBody>
          </Panel>
        );

      case 'rejected':
        return (
          <Panel className="h-full flex flex-col">
            <div className="px-4 py-3 border-b border-border bg-secondary/30 space-y-2 shrink-0">
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
                      <OrderIdentityDisplay order={{ batchNumber: r.batchNumber, coilNo: r.coilNo }} size="sm" className="min-w-0" />
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

      case 'handover':
        return (
          <Panel className="h-full">
            <div className="px-4 py-2 border-b border-border/60 bg-muted/20">
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Shift Handover Logs</h3>
            </div>
            <PanelBody empty={filteredHandover.length === 0}>
              <ul className="divide-y divide-border text-xs">
                {filteredHandover.map((h) => (
                  <li key={h.handoverId} className="px-4 py-3 hover:bg-secondary/50">
                    <div className="flex justify-between mb-1">
                      <span className="font-bold">{h.machineCode}</span>
                      <span className="text-muted-foreground font-mono">Shift {h.outgoingShiftCode} → {h.incomingShiftCode}</span>
                    </div>
                    <p className="text-muted-foreground">
                      {h.batchNumber ? `Order ${h.batchNumber}` : 'Machine handover'}
                      {h.subProcess ? ` · ${h.subProcess === 'SKIN_PASS' ? 'Skin Pass' : 'Cold Rolling'}` : ''}
                    </p>
                    <p className="text-muted-foreground">
                      Start {formatPlantDateTime(h.shiftStartAt ?? h.createdAt)}
                      {h.shiftEndAt ? ` · End ${formatPlantDateTime(h.shiftEndAt)}` : ''}
                      {h.shiftDurationMinutes != null ? ` · ${h.shiftDurationLabel ?? formatDuration(h.shiftDurationMinutes)}` : ''}
                    </p>
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
      title="Machine Dashboard"
      subtitle={
        machineAccess.length > 0
          ? `Assigned: ${machineAccess.join(', ')}${dashboard?.shiftSummary ? ` · ${dashboard.shiftSummary.prodDate} · Shift ${dashboard.shiftSummary.shiftCode}` : ''}`
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

        {machineAccess.length === 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-2 text-sm text-warning shrink-0">
            No machines assigned to your profile. Contact Plant Head for access.
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

        <div className="shrink-0 overflow-x-auto pb-1">
          <ZPillTabs
            tabs={tabs}
            activeId={activeTab}
            onChange={(id) => setActiveTab(id as DashboardTab)}
            className="min-w-max"
          />
        </div>

        {PROCESS_FILTER_TABS.includes(activeTab) && (
          <div className="shrink-0 overflow-x-auto pb-1">
            <ZPillTabs
              tabs={processFilterTabs}
              activeId={processFilter}
              onChange={(id) => setProcessFilter(id as ProcessFilter)}
              className="min-w-max"
            />
          </div>
        )}

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
            <aside className="min-h-0 xl:max-h-full hidden xl:block">
              <MachineHeadOrderSidePanel
                order={selectedOrder}
                onViewDetails={() => setDetailOpen(true)}
                onDelete={() => void handleDelete()}
                deleteBusy={deleteBusy}
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
