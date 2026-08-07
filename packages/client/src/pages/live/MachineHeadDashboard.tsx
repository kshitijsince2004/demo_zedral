// PERF-B1/B2/B3 — memo rows + virtualize + thin container
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveOrderRow, MachineHeadDashboardData, MachineStatusCard } from '@m1/shared-validation';
import { CommandMetric } from '../../components/command/CommandMetric';
import { MachineDetailModal } from '../../components/live/MachineDetailModal';
import { MachineHeadShell } from '../../components/layout/machinehead/MachineHeadShell';
import { MachineHeadOrderSidePanel } from '../../components/machinehead/MachineHeadOrderSidePanel';
import { MachineHeadOrderDetailModal } from '../../components/machinehead/MachineHeadOrderDetailModal';
import { ZPillTabs } from '../../components/ui/operator/ZPillTabs';
import { useLiveSnapshot, LIVE_POLL_MS } from '../../hooks/useLiveSnapshot';
import { liveService } from '../../lib/liveService';
import { useOperationalMachineAccess } from '../../lib/useOperationalMachineAccess';
import { isPlantWideDeskRole, useEffectiveSessionRole } from '../../lib/sessionRole';
import { displayMotherCoilId } from '../../lib/sixHiOrderIdentity';
import { reportingService } from '../../lib/reportingService';
import { ExportProgressModal } from '../../components/export/ExportProgressModal';
import { currentPlantDate } from '../../lib/dateFormat';
import { apiClient } from '../../lib/apiClient';
import { deleteOrder } from '../../lib/sync/sixHiWrites';
import { postQueued } from '../../lib/sync/queuedApi';
import { invalidateAfterWrite } from '../../lib/sync/invalidateAfterWrite';
import { jsonFingerprint } from '../../lib/silentRefresh';
import { formatProcessFilterLabel } from '../../lib/orderLabels';
import { DataFreshnessBadge } from '../../components/DataFreshnessBadge';
import {
  type ManualRerollSession,
  listManualRerollSessions,
} from '../../services/manualRerollService';
import {
  ACTIVE_ORDER_STATUSES,
  CRM_HISTORY_MILLS,
  DASHBOARD_TABS,
  ORDER_TABS,
  PROCESS_FILTER_TABS,
  type DashboardTab,
  type HistoryProcessFilter,
  type HistoryRow,
  type ProcessFilter,
  mapCrmCompletedToHistory,
  mapRerollSessionToHistory,
  matchesProcessFilter,
  sessionPlantDate,
} from './MachineHeadDashboardPanels';
import { renderMachineHeadTabContent } from './MachineHeadDashboardTabs';

export function MachineHeadDashboard() {
  const { role } = useEffectiveSessionRole();
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
  const [completedOrders, setCompletedOrders] = useState<HistoryRow[]>([]);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [historyProcessFilter, setHistoryProcessFilter] = useState<HistoryProcessFilter>('ALL');
  const [processFilter, setProcessFilter] = useState<ProcessFilter>('ALL');
  const [machineFilter, setMachineFilter] = useState<string>('ALL');
  const [shiftFilter, setShiftFilter] = useState<string>('ALL');
  const [stoppageReason, setStoppageReason] = useState<string>('ALL');
  const [orderSearch, setOrderSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [machineModalCode, setMachineModalCode] = useState<string | null>(null);
  const [machineModalData, setMachineModalData] = useState<MachineStatusCard | undefined>();
  const [historyNextCursor, setHistoryNextCursor] = useState<string | null>(null);
  const historyLoadingMoreRef = useRef(false);
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
    let cancelled = false;
    setCompletedLoading(true);

    const millCodes = (() => {
      const scoped = dashFilters.machine
        ? [dashFilters.machine]
        : (isPlantWideDeskRole(role)
          ? [...CRM_HISTORY_MILLS]
          : assignedMachines);
      return scoped
        .map((m) => m.toUpperCase())
        .filter((m): m is typeof CRM_HISTORY_MILLS[number] =>
          (CRM_HISTORY_MILLS as readonly string[]).includes(m));
    })();

    const wantCrm = historyProcessFilter === 'ALL'
      || historyProcessFilter === 'ROLLING'
      || historyProcessFilter === 'SKIN_PASS';
    const wantReroll = historyProcessFilter === 'ALL' || historyProcessFilter === 'MANUAL_REROLL';

    async function loadHistory() {
      try {
        const crmRows: HistoryRow[] = [];
        if (wantCrm) {
          const qs = new URLSearchParams();
          if (exportDate) qs.set('date', exportDate);
          if (exportShift) qs.set('shiftCode', exportShift);
          if (dashFilters.machine) qs.set('machine', dashFilters.machine);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const res = await apiClient.get<any[]>(`/6hi/orders/completed?${qs.toString()}`);
          const q = debouncedSearch.toLowerCase();
          for (const o of res) {
            const sub = o.subProcess === 'SKIN_PASS' ? 'SKIN_PASS' : 'ROLLING';
            if (historyProcessFilter === 'ROLLING' && sub !== 'ROLLING') continue;
            if (historyProcessFilter === 'SKIN_PASS' && sub !== 'SKIN_PASS') continue;
            if (q) {
              const hay = `${o.batchNumber} ${o.coilNo ?? ''} ${o.customer ?? ''}`.toLowerCase();
              if (!hay.includes(q)) continue;
            }
            crmRows.push(mapCrmCompletedToHistory(o));
          }
        }

        const rerollRows: HistoryRow[] = [];
        if (wantReroll && millCodes.length > 0) {
          const results = await Promise.all(
            millCodes.map((m) => listManualRerollSessions(m).catch(() => ({ sessions: [] as ManualRerollSession[] }))),
          );
          const q = debouncedSearch.toLowerCase();
          for (const pack of results) {
            for (const s of pack.sessions) {
              if (s.status !== 'COMPLETED') continue;
              if (exportDate && sessionPlantDate(s) !== exportDate) continue;
              if (exportShift && (s.shiftCode ?? '').toUpperCase() !== exportShift.toUpperCase()) continue;
              if (q) {
                const hay = `${s.batchNumber ?? ''} ${(s.batchNumbers ?? []).join(' ')} ${s.machineCode}`.toLowerCase();
                if (!hay.includes(q)) continue;
              }
              rerollRows.push(mapRerollSessionToHistory(s));
            }
          }
        }

        const merged = [...crmRows, ...rerollRows].sort((a, b) =>
          String(b.prodEndAt ?? '').localeCompare(String(a.prodEndAt ?? '')));
        if (!cancelled) setCompletedOrders(merged);
      } catch (err) {
        console.error('Failed to load history', err);
        if (!cancelled) setCompletedOrders([]);
      } finally {
        if (!cancelled) setCompletedLoading(false);
      }
    }

    void loadHistory();
    return () => { cancelled = true; };
  }, [
    activeTab,
    exportDate,
    exportShift,
    dashFilters.machine,
    debouncedSearch,
    historyProcessFilter,
    assignedMachines,
    role,
  ]);

  const loadDashboard = useCallback(async () => {
    try {
      // PERF-C2 — first page only; load-more appends via historyCursor
      const dash = await liveService.getMachineHeadDashboard({ ...dashFilters, historyLimit: 50 });
      const fingerprint = jsonFingerprint(dash);
      if (fingerprint !== prevDashboardFpRef.current) {
        prevDashboardFpRef.current = fingerprint;
        setDashboard(dash);
        setHistoryNextCursor(dash.productionHistoryNextCursor ?? null);
      }
      setDashError(null);
    } catch (err: unknown) {
      setDashError((err as Error)?.message ?? 'Unable to load machine dashboard');
    }
  }, [dashFilters]);

  const loadMoreProductionHistory = useCallback(async () => {
    if (!historyNextCursor || historyLoadingMoreRef.current) return;
    historyLoadingMoreRef.current = true;
    try {
      const page = await liveService.getMachineHeadDashboard({
        ...dashFilters,
        historyLimit: 50,
        historyCursor: historyNextCursor,
      });
      setDashboard((prev) =>
        prev
          ? { ...prev, productionHistory: [...prev.productionHistory, ...page.productionHistory] }
          : page,
      );
      setHistoryNextCursor(page.productionHistoryNextCursor ?? null);
    } catch {
      /* keep cursor; next near-end retries */
    } finally {
      historyLoadingMoreRef.current = false;
    }
  }, [dashFilters, historyNextCursor]);

  useEffect(() => {
    void loadDashboard();
    const id = setInterval(() => void loadDashboard(), LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [loadDashboard]);

  const machines = useMemo(() => {
    const all = (snapshot?.machines ?? []).filter((m) => m.status !== 'OFFLINE');
    if (isPlantWideDeskRole(role)) return all;
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
    const deduped = [...new Map(rows.map((h) => [h.handoverId, h])).values()];
    // Pending first, then completed (manual + auto) by prod date / created time.
    const rank = (status: string) => (status === 'PENDING' ? 0 : 1);
    return deduped.sort((a, b) => {
      const byStatus = rank(a.status) - rank(b.status);
      if (byStatus !== 0) return byStatus;
      const dayCmp = String(b.prodDate ?? '').localeCompare(String(a.prodDate ?? ''));
      if (dayCmp !== 0) return dayCmp;
      return String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''));
    });
  }, [dashboard?.handoverOverview]);

  const processFilterTabs = useMemo(() => (
    ['ALL', 'ROLLING', 'SKIN_PASS'] as ProcessFilter[]
  ).map((id) => ({ id, label: formatProcessFilterLabel(id) })), []);

  const historyProcessFilterTabs = useMemo(() => (
    ['ALL', 'ROLLING', 'SKIN_PASS', 'MANUAL_REROLL'] as HistoryProcessFilter[]
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

  const selectedBatch = selectedOrder?.batchNumber ?? null;
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

  const tabContent = renderMachineHeadTabContent({
    activeTab,
    dashboard,
    machines,
    openMachineDetail,
    filteredQueue,
    filteredProduction,
    filteredOperatorActivity,
    filteredStoppages,
    stoppageCategories,
    stoppageReason,
    setStoppageReason,
    filteredRejected,
    rejectedLoading,
    filteredHandover,
    completedOrders,
    completedLoading,
    exportDate,
    setExportDate,
    exportShift,
    setExportShift,
    handleExportRejected,
    selectedBatch,
    selectOrder,
    onLoadMoreProduction: historyNextCursor ? () => { void loadMoreProductionHistory(); } : undefined,
  });

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
      headerActions={<DataFreshnessBadge />}
    >
      <div className="flex flex-col flex-1 min-h-0 gap-3">
        {(error || dashError) && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive shrink-0">
            {error ?? dashError}
          </div>
        )}

        {(dashboard?.deskNotifications?.length ?? 0) > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm shrink-0 space-y-2">
            <p className="font-semibold text-foreground">Action required — auto-closed shifts</p>
            {dashboard!.deskNotifications!.slice(0, 5).map((n) => {
              const reviewPath =
                typeof n.payload?.reviewPath === 'string'
                  ? n.payload.reviewPath
                  : n.shiftLogId
                    ? `/machine-head/shift-review?shiftLogId=${n.shiftLogId}`
                    : '/machine-head/shift-review';
              return (
                <div key={n.notificationId} className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-muted-foreground flex-1 min-w-0">{n.body}</p>
                  <a
                    href={reviewPath}
                    className="text-xs font-semibold text-primary underline shrink-0"
                  >
                    Open Shift Review
                  </a>
                </div>
              );
            })}
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
                tabs={activeTab === 'completed' ? historyProcessFilterTabs : processFilterTabs}
                activeId={activeTab === 'completed' ? historyProcessFilter : processFilter}
                onChange={(id) => {
                  if (activeTab === 'completed') setHistoryProcessFilter(id as HistoryProcessFilter);
                  else setProcessFilter(id as ProcessFilter);
                }}
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
            {tabContent}
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
