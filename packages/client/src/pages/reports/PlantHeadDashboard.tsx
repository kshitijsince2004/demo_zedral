import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LiveKpis, LiveOrderRow } from '@m1/shared-validation';
import {
  reportingService,
  type ExtendedPlantHeadDashboardData,
} from '../../lib/reportingService';
import { useLiveSnapshot, LIVE_POLL_MS } from '../../hooks/useLiveSnapshot';
import { liveService } from '../../lib/liveService';
import { mergePlantHeadWithLive } from '../../lib/plantHeadLiveMerge';
import { subscribeProductionChanged } from '../../lib/productionSync';
import { machineHandoverService, type HandoverOverviewRow } from '../../services/machineHandoverService';
import { ExportProgressModal } from '../../components/export/ExportProgressModal';
import { ZButton } from '../../components/primitives/ZButton';
import { Download } from 'lucide-react';
import { currentPlantDate, formatPlantDateTime } from '../../lib/dateFormat';

function formatDuration(minutes?: number): string {
  if (minutes == null || minutes < 0) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

import { PlantKpiStrip } from '../../components/plant-head/PlantKpiStrip';
import { BacklogDetailDrawer } from '../../components/plant-head/BacklogDetailDrawer';
import { RejectedOrdersDrawer } from '../../components/plant-head/RejectedOrdersDrawer';
import { ORDER_HOLD_STATUS_LABEL } from '../../lib/orderLabels';
import { OrderDetailModal } from '../../components/live/OrderDetailModal';
import type { LiveOrderDetail } from '@m1/shared-validation';
import { PlantMainOpsArea } from '../../components/plant-head/PlantMainOpsArea';
import { PlantQualityDowntimeArea } from '../../components/plant-head/PlantQualityDowntimeArea';
import { PlantOperationsArea } from '../../components/plant-head/PlantOperationsArea';
import { PlantOpsFeed } from '../../components/plant-head/PlantOpsFeed';
import { MachineStatusBoard } from '../../components/live/MachineStatusBoard';
import { AlertTriangle, Factory, RefreshCw } from 'lucide-react';
import { jsonFingerprint } from '../../lib/silentRefresh';

export function PlantHeadDashboard() {
  const [windowDays, setWindowDays] = useState<1 | 7 | 30 | 90>(7);
  const [data, setData] = useState<ExtendedPlantHeadDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveOrders, setLiveOrders] = useState<LiveOrderRow[]>([]);
  const [liveOrdersError, setLiveOrdersError] = useState<string | null>(null);
  const [handovers, setHandovers] = useState<HandoverOverviewRow[]>([]);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedDetail, setSelectedDetail] = useState<LiveOrderDetail | null>(null);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportDate, setExportDate] = useState(currentPlantDate());
  const [exportShift, setExportShift] = useState('A');
  const { snapshot } = useLiveSnapshot();
  const prevDataFpRef = useRef('');
  const prevHandoversFpRef = useRef('');
  const prevLiveOrdersFpRef = useRef('');

  const startRejectedExport = async (mode: 'day' | 'shift') => {
    try {
      const scope: Record<string, string> = {
        dateFrom: exportDate,
        dateTo: exportDate,
      };
      if (mode === 'shift') scope.shiftCode = exportShift;
      const job = await reportingService.createExport({ type: 'REJECTED_ORDERS', format: 'XLSX', scope });
      setExportJobId(job.jobId);
    } catch (e: unknown) {
      alert((e as Error)?.message || 'Export failed');
    }
  };

  const openOrderDetail = useCallback(async (batchNumber: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    setSelectedDetail(null);
    try {
      const detail = await liveService.getOrderDetail(batchNumber);
      setSelectedDetail(detail);
    } catch {
      setSelectedDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setRefreshing(true);
    }
    setError(null);
    try {
      const result = await reportingService.getExtendedPlantHeadDashboard(windowDays);
      const fingerprint = jsonFingerprint(result);
      if (!silent || fingerprint !== prevDataFpRef.current) {
        prevDataFpRef.current = fingerprint;
        setData(result);
      }
    } catch (err: unknown) {
      if (!silent) setError(err instanceof Error ? err.message : 'Unable to load dashboard data');
    } finally {
      if (!silent) setLoading(false);
      if (!silent) setRefreshing(false);
    }

    // Handover logs are supplemental — failure must not block the command center.
    try {
      const hResult = await machineHandoverService.getOverview();
      const handoverFp = jsonFingerprint(hResult.recent || []);
      if (!silent || handoverFp !== prevHandoversFpRef.current) {
        prevHandoversFpRef.current = handoverFp;
        setHandovers(hResult.recent || []);
      }
    } catch {
      if (!silent) setHandovers([]);
    }
  }, [windowDays]);

  useEffect(() => {
    load(false);
    const interval = setInterval(() => load(true), 30000);
    const unsub = subscribeProductionChanged(() => load(true));
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, [load]);

  useEffect(() => {
    let active = true;
    const loadOrders = () => {
      liveService
        .getOrders()
        .then((res) => {
          if (!active) return;
          const fingerprint = jsonFingerprint(res.orders);
          if (fingerprint !== prevLiveOrdersFpRef.current) {
            prevLiveOrdersFpRef.current = fingerprint;
            setLiveOrders(res.orders);
          }
          setLiveOrdersError(null);
        })
        .catch((err: unknown) => {
          if (!active) return;
          setLiveOrders([]);
          setLiveOrdersError((err as Error)?.message ?? 'Live order feed unavailable');
        });
    };
    loadOrders();
    const interval = setInterval(loadOrders, LIVE_POLL_MS);
    return () => { active = false; clearInterval(interval); };
  }, []);

  const liveKpis: LiveKpis | undefined = snapshot?.kpis;
  const liveMachines = useMemo(() => snapshot?.machines ?? [], [snapshot?.machines]);

  const displayData = useMemo(
    () => (data ? mergePlantHeadWithLive(data, liveKpis, liveMachines, liveOrders) : null),
    [data, liveKpis, liveMachines, liveOrders],
  );

  if (loading && !data) {
    return (
      <div
        className="flex items-center justify-center min-h-[320px]"
        data-testid="plant-head-dashboard-loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Factory className="w-10 h-10 animate-pulse opacity-40" aria-hidden />
          <span className="text-sm font-medium">Loading Command Center…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-6 w-full p-6" data-testid="plant-head-dashboard-error" role="alert">
        <div className="flex items-start gap-3 p-5 text-red-700 bg-red-50 border border-red-200 rounded-xl">
          <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden />
          <div>
            <div className="font-semibold text-sm mb-1">Failed to load dashboard</div>
            <div className="text-sm">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  if (!displayData) return null;

  return (
    <div
      className="flex flex-col w-full h-full pb-6 max-w-screen-2xl mx-auto"
      data-testid="plant-head-dashboard"
      role="main"
      aria-label="Plant command center"
    >

      {/* Header */}
      <div className="flex justify-end gap-4 mb-3 px-1">

        <div className="flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => load(false)}
            disabled={loading || refreshing}
            aria-label="Refresh dashboard"
            className="flex items-center gap-2 h-9 px-3 rounded-lg border border-border bg-card text-sm text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-info' : ''}`} aria-hidden />
            Refresh
          </button>
          <select
            value={windowDays}
            onChange={(e) => setWindowDays(Number(e.target.value) as 1 | 7 | 30 | 90)}
            aria-label="Reporting time window"
            className="h-9 rounded-lg border border-input bg-card px-3 text-sm font-medium text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            <option value={1}>Last 24 Hours</option>
            <option value={7}>Last 7 Days</option>
            <option value={30}>Last 30 Days</option>
            <option value={90}>Last 90 Days</option>
          </select>
        </div>
      </div>



      <div className="flex flex-col gap-5 min-h-0">

        {/* KPI Strip */}
        <section aria-label="Key performance indicators">
          <PlantKpiStrip
            data={displayData}
            liveKpis={liveKpis}
            onBacklogClick={() => setBacklogOpen(true)}
          />
        </section>

        <BacklogDetailDrawer open={backlogOpen} onClose={() => setBacklogOpen(false)} />
        <RejectedOrdersDrawer
          open={rejectedOpen}
          onClose={() => setRejectedOpen(false)}
          date={exportDate}
          shiftCode={exportShift}
          onSelect={(batchNumber) => {
            setRejectedOpen(false);
            void openOrderDetail(batchNumber);
          }}
        />
        <OrderDetailModal
          open={detailOpen}
          order={selectedDetail}
          loading={detailLoading}
          onClose={() => {
            setDetailOpen(false);
            setSelectedDetail(null);
          }}
        />

        {/* Live Machine Status Board */}
        {liveMachines.length > 0 && (
          <section className="flex flex-col gap-3">
            <div className="px-1">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Live Shopfloor Status
              </h2>
            </div>
            <MachineStatusBoard machines={liveMachines} />
          </section>
        )}

        {/* Production + Insights */}
        <section>
          <PlantMainOpsArea data={displayData} liveKpis={liveKpis} />
        </section>

        {/* Quality + Downtime */}
        <section>
            <PlantQualityDowntimeArea data={displayData} />

            <div className="bg-white border border-border rounded-3xl shadow-sm overflow-hidden flex flex-col h-[400px]">
              <div className="flex items-center justify-between border-b border-border/50 bg-secondary/50 px-5 py-3 shrink-0 gap-3">
                <div className="flex items-center gap-2 text-primary font-bold">
                  <Factory className="w-5 h-5 text-muted-foreground" />
                  <h2>Shift Handover Logs</h2>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <input
                    type="date"
                    value={exportDate}
                    onChange={(e) => setExportDate(e.target.value)}
                    className="rounded-lg border border-border bg-white px-2 py-1 text-xs"
                    aria-label="Export date"
                  />
                  <select
                    value={exportShift}
                    onChange={(e) => setExportShift(e.target.value)}
                    className="rounded-lg border border-border bg-white px-2 py-1 text-xs"
                    aria-label="Export shift"
                  >
                    {['A', 'B', 'C'].map((s) => (
                      <option key={s} value={s}>Shift {s}</option>
                    ))}
                  </select>
                  <ZButton variant="outline" size="sm" onClick={() => setRejectedOpen(true)} className="gap-1 shrink-0">
                    Order Problems ({ORDER_HOLD_STATUS_LABEL})
                  </ZButton>
                  <ZButton variant="outline" size="sm" onClick={() => startRejectedExport('day')} className="gap-1 shrink-0">
                    <Download className="w-4 h-4" /> Day
                  </ZButton>
                  <ZButton variant="outline" size="sm" onClick={() => startRejectedExport('shift')} className="gap-1 shrink-0">
                    <Download className="w-4 h-4" /> Shift
                  </ZButton>
                </div>
              </div>
              <div className="p-0 overflow-y-auto min-h-0 relative bg-muted/5 flex-1">
                {handovers.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">No recent handovers.</div>
                ) : (
                  <ul className="text-sm divide-y divide-border">
                    {handovers.map((h) => (
                      <li key={h.handoverId} className="px-5 py-3 hover:bg-white transition-colors">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold text-foreground">{h.machineCode}</span>
                          <span className="text-muted-foreground font-mono text-xs bg-muted/30 px-2 py-0.5 rounded">
                            Shift {h.outgoingShiftCode} → {h.incomingShiftCode}
                          </span>
                        </div>
                        <div className="space-y-1 text-xs text-muted-foreground mt-2">
                          <div>
                            <span className="font-medium">Shift Start Time:</span>{' '}
                            {formatPlantDateTime(h.shiftStartAt ?? h.createdAt)}
                          </div>
                          {h.shiftEndAt && (
                            <div>
                              <span className="font-medium text-emerald-600">Shift End Time:</span>{' '}
                              {formatPlantDateTime(h.shiftEndAt)}
                            </div>
                          )}
                          {h.shiftDurationMinutes != null && (
                            <div>
                              <span className="font-medium">Duration:</span>{' '}
                              {h.shiftDurationLabel ?? formatDuration(h.shiftDurationMinutes)}
                            </div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {exportJobId && (
              <ExportProgressModal jobId={exportJobId} onClose={() => setExportJobId(null)} />
            )}
        </section>

        {/* Machine Utilization + Orders */}
        <section>
          <PlantOperationsArea
            data={displayData}
            liveMachines={liveMachines}
            liveOrders={liveOrders}
            liveOrdersError={liveOrdersError}
            onOrderClick={(batchNumber) => void openOrderDetail(batchNumber)}
          />
        </section>

        {/* Ops Feed */}
        <section>
          <PlantOpsFeed data={displayData} />
        </section>

      </div>
    </div>
  );
}
