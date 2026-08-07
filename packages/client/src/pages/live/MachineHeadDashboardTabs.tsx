// PERF-B3 - tab panels for MachineHeadDashboard
import type { LiveOrderRow, MachineHeadDashboardData, MachineStatusCard } from '@m1/shared-validation';
import { Download } from 'lucide-react';
import { MachineStatusBoard } from '../../components/live/MachineStatusBoard';
import { VirtualizedList } from '../../components/VirtualizedList';
import { ZButton } from '../../components/primitives/ZButton';
import {
  type DashboardTab,
  type HistoryRow,
  VIRTUALIZE_THRESHOLD,
  Panel,
  PanelBody,
  PanelHeader,
  StatCell,
} from './MachineHeadDashboardPanels';
import {
  CompletedHistoryRow,
  HandoverListRow,
  OperatorActivityRow,
  ProductionHistoryRow,
  QueueOrderRow,
  RejectedOrderListRow,
  StoppageRow,
} from './MachineHeadDashboardRows';

export function renderMachineHeadTabContent(p: {
  activeTab: DashboardTab;
  dashboard: MachineHeadDashboardData | null;
  machines: MachineStatusCard[];
  openMachineDetail: (code: string) => void;
  filteredQueue: LiveOrderRow[];
  filteredProduction: MachineHeadDashboardData['productionHistory'];
  filteredOperatorActivity: MachineHeadDashboardData['operatorActivity'];
  filteredStoppages: MachineHeadDashboardData['stoppages'];
  stoppageCategories: string[];
  stoppageReason: string;
  setStoppageReason: (v: string) => void;
  filteredRejected: NonNullable<MachineHeadDashboardData['rejectedOrders']>;
  rejectedLoading: boolean;
  filteredHandover: import('@m1/shared-validation').HandoverOverviewRow[];
  completedOrders: HistoryRow[];
  completedLoading: boolean;
  exportDate: string;
  setExportDate: (v: string) => void;
  exportShift: string;
  setExportShift: (v: string) => void;
  handleExportRejected: (mode: 'day' | 'shift') => void;
  selectedBatch: string | null;
  selectOrder: (row: LiveOrderRow) => void;
  onLoadMoreProduction?: () => void;
}) {
  const {
    activeTab, dashboard, machines, openMachineDetail,
    filteredQueue, filteredProduction, filteredOperatorActivity,
    filteredStoppages, stoppageCategories, stoppageReason, setStoppageReason,
    filteredRejected, rejectedLoading, filteredHandover,
    completedOrders, completedLoading,
    exportDate, setExportDate, exportShift, setExportShift, handleExportRejected,
    selectedBatch, selectOrder,
  } = p;
    if (!dashboard && activeTab !== 'overview') {
      return <p className="text-sm text-muted-foreground py-8 text-center">Loading dashboard data-</p>;
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
                      value={`${dashboard.shiftSummary.orderCount} - ${dashboard.shiftSummary.completedOrderCount} done`}
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
              {/* PERF-B2 - sticky thead outside VirtualizedList scroll */}
              <div className="min-w-full inline-block align-middle">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/50 sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Order / Coil</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Customer</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Process</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Weight</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                </table>
                {filteredQueue.length > VIRTUALIZE_THRESHOLD ? (
                  <VirtualizedList
                    items={filteredQueue}
                    estimateSize={56}
                    className="max-h-[min(60vh,720px)]"
                    getKey={(o) => o.batchNumber}
                    renderItem={(o) => (
                      <table className="min-w-full"><tbody className="divide-y divide-border">
                        <QueueOrderRow o={o} onSelectOrder={selectOrder} />
                      </tbody></table>
                    )}
                  />
                ) : (
                  <table className="min-w-full divide-y divide-border">
                    <tbody className="bg-transparent divide-y divide-border">
                      {filteredQueue.map((o) => (
                        <QueueOrderRow key={o.batchNumber} o={o} onSelectOrder={selectOrder} />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </PanelBody>
          </Panel>
        );

      case 'production':
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full min-h-0">
            <Panel>
              <PanelHeader title="Production History - This Shift" />
              <PanelBody empty={filteredProduction.length === 0}>
                {dashboard && filteredProduction.length > VIRTUALIZE_THRESHOLD ? (
                  <VirtualizedList
                    items={filteredProduction}
                    estimateSize={44}
                    className="max-h-[min(60vh,720px)]"
                    getKey={(h) => `${h.batchNumber}-${h.completedAt}`}
                    onNearEnd={p.onLoadMoreProduction}
                    renderItem={(h) => (
                      <ul className="divide-y divide-border text-xs">
                        <ProductionHistoryRow
                          h={h}
                          selectedBatch={selectedBatch}
                          dashboard={dashboard}
                          onSelectOrder={selectOrder}
                        />
                      </ul>
                    )}
                  />
                ) : (
                  <ul className="divide-y divide-border text-xs">
                    {dashboard && filteredProduction.map((h) => (
                      <ProductionHistoryRow
                        key={`${h.batchNumber}-${h.completedAt}`}
                        h={h}
                        selectedBatch={selectedBatch}
                        dashboard={dashboard}
                        onSelectOrder={selectOrder}
                      />
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>
            <Panel>
              <PanelHeader title="Operator Activity" />
              <PanelBody empty={filteredOperatorActivity.length === 0}>
                {dashboard && filteredOperatorActivity.length > VIRTUALIZE_THRESHOLD ? (
                  <VirtualizedList
                    items={filteredOperatorActivity}
                    estimateSize={44}
                    className="max-h-[min(60vh,720px)]"
                    getKey={(a) => `${a.batchNumber}-${a.operatorName}`}
                    renderItem={(a) => (
                      <ul className="divide-y divide-border text-xs">
                        <OperatorActivityRow
                          a={a}
                          selectedBatch={selectedBatch}
                          dashboard={dashboard}
                          onSelectOrder={selectOrder}
                        />
                      </ul>
                    )}
                  />
                ) : (
                  <ul className="divide-y divide-border text-xs">
                    {dashboard && filteredOperatorActivity.map((a) => (
                      <OperatorActivityRow
                        key={`${a.batchNumber}-${a.operatorName}`}
                        a={a}
                        selectedBatch={selectedBatch}
                        dashboard={dashboard}
                        onSelectOrder={selectOrder}
                      />
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>
          </div>
        );

      case 'stoppages':
        return (
          <Panel className="h-full flex flex-col">
            <PanelHeader title="Stoppage History - This Shift">
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
                  <thead className="bg-muted/50 sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Machine</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Order</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Reason</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Start Time</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Duration</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                </table>
                {dashboard && filteredStoppages.length > VIRTUALIZE_THRESHOLD ? (
                  <VirtualizedList
                    items={filteredStoppages}
                    estimateSize={64}
                    className="max-h-[min(60vh,720px)]"
                    getKey={(s) => `${s.batchNumber}-${s.startAt}`}
                    renderItem={(s) => (
                      <table className="min-w-full"><tbody className="divide-y divide-border">
                        <StoppageRow s={s} dashboard={dashboard} onSelectOrder={selectOrder} />
                      </tbody></table>
                    )}
                  />
                ) : (
                  <table className="min-w-full divide-y divide-border">
                    <tbody className="bg-transparent divide-y divide-border">
                      {dashboard && filteredStoppages.map((s) => (
                        <StoppageRow
                          key={`${s.batchNumber}-${s.startAt}`}
                          s={s}
                          dashboard={dashboard}
                          onSelectOrder={selectOrder}
                        />
                      ))}
                    </tbody>
                  </table>
                )}
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
            <PanelBody empty={!rejectedLoading && filteredRejected.length === 0} emptyLabel={rejectedLoading ? 'Loading held orders-' : 'No orders on hold'}>
              {filteredRejected.length > VIRTUALIZE_THRESHOLD ? (
                <VirtualizedList
                  items={filteredRejected}
                  estimateSize={72}
                  className="max-h-[min(60vh,720px)]"
                  getKey={(r) => `${r.batchNumber}-${r.rejectionTime}`}
                  renderItem={(r) => (
                    <ul className="divide-y divide-border text-xs">
                      <RejectedOrderListRow r={r} selectedBatch={selectedBatch} onSelectOrder={selectOrder} />
                    </ul>
                  )}
                />
              ) : (
                <ul className="divide-y divide-border text-xs">
                  {filteredRejected.map((r) => (
                    <RejectedOrderListRow
                      key={`${r.batchNumber}-${r.rejectionTime}`}
                      r={r}
                      selectedBatch={selectedBatch}
                      onSelectOrder={selectOrder}
                    />
                  ))}
                </ul>
              )}
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
                    <dt className="text-xs font-medium text-muted-foreground">History rows</dt>
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
            <PanelBody empty={!completedLoading && completedOrders.length === 0} emptyLabel={completedLoading ? 'Loading history-' : 'No completed history'}>
              <div className="min-w-full inline-block align-middle">
                <table className="min-w-full divide-y divide-border">
                  <thead className="bg-muted/50 sticky top-0 z-10">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Order / Coil</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Process</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Machine</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Customer</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Weight</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">Completed At</th>
                    </tr>
                  </thead>
                </table>
                {completedOrders.length > VIRTUALIZE_THRESHOLD ? (
                  <VirtualizedList
                    items={completedOrders}
                    estimateSize={56}
                    className="max-h-[min(60vh,720px)]"
                    getKey={(o) => o.key}
                    renderItem={(o) => (
                      <table className="min-w-full"><tbody className="divide-y divide-border">
                        <CompletedHistoryRow o={o} onSelectOrder={selectOrder} />
                      </tbody></table>
                    )}
                  />
                ) : (
                  <table className="min-w-full divide-y divide-border">
                    <tbody className="bg-transparent divide-y divide-border">
                      {completedOrders.map((o) => (
                        <CompletedHistoryRow key={o.key} o={o} onSelectOrder={selectOrder} />
                      ))}
                    </tbody>
                  </table>
                )}
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
                  ? `Shift Handover - ${dashboard.shiftSummary.prodDate} - Shift ${dashboard.shiftSummary.shiftCode}`
                  : 'Shift Handover Logs'
              }
            >
              <span className="text-[10px] text-muted-foreground font-medium">
                Pending - Manual completed - Auto completed
              </span>
            </PanelHeader>
            <PanelBody empty={filteredHandover.length === 0}>
              {filteredHandover.length > VIRTUALIZE_THRESHOLD ? (
                <VirtualizedList
                  items={filteredHandover}
                  estimateSize={120}
                  className="max-h-[min(60vh,720px)]"
                  getKey={(h) => h.handoverId}
                  renderItem={(h) => (
                    <ul className="divide-y divide-border text-xs">
                      <HandoverListRow h={h} />
                    </ul>
                  )}
                />
              ) : (
                <ul className="divide-y divide-border text-xs">
                  {filteredHandover.map((h) => (
                    <HandoverListRow key={h.handoverId} h={h} />
                  ))}
                </ul>
              )}
            </PanelBody>
          </Panel>
        );

      default:
        return null;
    }
}