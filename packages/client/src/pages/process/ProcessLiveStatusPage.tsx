import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Play } from 'lucide-react';
import { ZButton } from '../../components/primitives/ZButton';
import { ZBadge } from '../../components/primitives/ZBadge';
import { ShiftStoppageHistory } from '../../components/sixHi/ShiftStoppageHistory';
import { resolveStoppageDisplayCode } from '../../components/sixHi/SixHiStoppageCodes';
import { ProcessShiftSummaryPanel } from '../../components/process/ProcessShiftSummaryPanel';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { apiClient } from '../../lib/apiClient';
import { getProcessConfig, isProcessStationCode } from '../../lib/processConfig';
import { useProcessStore } from '../../store/processStore';
import { useShiftStore } from '../../store/shiftStore';
import { formatPlantClock } from '../../lib/dateFormat';
import { useLiveTimer } from '../../hooks/useLiveTimer';
import { useProcessNetTimer } from '../../hooks/useProcessNetTimer';
import type { Tone } from '../../lib/tones';

interface ProcessLiveStatusPageProps {
  processCode: string;
}

type HistoryRow = {
  id: string;
  startTime: string;
  endTime?: string | null;
  durationMins?: number | null;
  categoryCode?: string;
  categoryName?: string;
  remarks?: string | null;
};

/** Capture tab for process lines — running order, upcoming queue, stoppage history (+ PKL shift summary). */
export function ProcessLiveStatusPage({ processCode }: ProcessLiveStatusPageProps) {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const config = getProcessConfig(processCode);
  const { producedMt, targetMt, shiftLogId } = useShiftStore();
  const {
    queue,
    loadQueueFor,
    activeCoilNo,
    captureStatus,
    runStartedAt,
    stoppageStartedAt,
    runStoppages,
    activeStoppageId,
    hydrateProcessRun,
  } = useProcessStore();
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [pklMetrics, setPklMetrics] = useState<{
    totalProdMt: number; coilsDone: number; avgLineSpeed: number; repeats: number;
    wpW?: number; wpP?: number; chartReadings: number; chartDue: number;
  } | null>(null);
  const [pklMetricsLoading, setPklMetricsLoading] = useState(false);
  const [hrsMetrics, setHrsMetrics] = useState<{
    targetMt: number; totalProdMt: number; scrapMt: number; scrapPct: number; coilsDone: number; settingCount: number;
  } | null>(null);
  const [hrsMetricsLoading, setHrsMetricsLoading] = useState(false);

  useEffect(() => {
    if (!isProcessStationCode(processCode)) return;
    void loadQueueFor(processCode);
  }, [loadQueueFor, processCode]);

  useEffect(() => {
    if (!shiftLogId) {
      setHistoryRows([]);
      return;
    }
    let cancelled = false;
    void apiClient
      .get(`/stations/${processCode}/shift/${encodeURIComponent(shiftLogId)}/stoppages`)
      .then((rows: Array<{
        id: string;
        startAt: string;
        endAt?: string;
        durationMin?: number;
        categoryCode?: string;
        categoryLabel?: string;
        breakdownCode?: string;
        remarks?: string;
      }>) => {
        if (cancelled) return;
        const list = Array.isArray(rows) ? rows : [];
        setHistoryRows(list.map((s) => ({
          id: s.id,
          startTime: s.startAt,
          endTime: s.endAt ?? null,
          durationMins: s.durationMin ?? null,
          categoryCode: resolveStoppageDisplayCode(s.categoryCode ?? '', s.breakdownCode),
          categoryName: s.categoryLabel ?? 'Stoppage',
          remarks: s.remarks ?? null,
        })));
      })
      .catch(() => {
        if (!cancelled) setHistoryRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [processCode, shiftLogId, captureStatus]);

  useEffect(() => {
    if (processCode !== 'PKL' || !shiftLogId) {
      setPklMetrics(null);
      return;
    }
    let cancelled = false;
    setPklMetricsLoading(true);
    void apiClient
      .get<{
        totalProdMt: number; coilsDone: number; avgLineSpeed: number; repeats: number;
        wpW?: number; wpP?: number; chartReadings: number; chartDue: number;
      }>(`/stations/pkl/shift-metrics/${encodeURIComponent(shiftLogId)}`)
      .then((m) => {
        if (!cancelled) setPklMetrics(m);
      })
      .catch(() => {
        if (!cancelled) setPklMetrics(null);
      })
      .finally(() => {
        if (!cancelled) setPklMetricsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [processCode, shiftLogId, producedMt]);

  useEffect(() => {
    if (processCode !== 'HRS' || !shiftLogId) {
      setHrsMetrics(null);
      return;
    }
    let cancelled = false;
    setHrsMetricsLoading(true);
    void apiClient
      .get<{
        targetMt: number; totalProdMt: number; scrapMt: number; scrapPct: number; coilsDone: number; settingCount: number;
      }>(`/stations/hrs/shift-metrics/${encodeURIComponent(shiftLogId)}`)
      .then((m) => {
        if (!cancelled) setHrsMetrics(m);
      })
      .catch(() => {
        if (!cancelled) setHrsMetrics(null);
      })
      .finally(() => {
        if (!cancelled) setHrsMetricsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [processCode, shiftLogId, producedMt]);

  const pklShiftItems = useMemo(() => {
    if (!pklMetrics) return [];
    return [
      { label: 'Pickled MT', value: pklMetrics.totalProdMt.toFixed(2) },
      { label: 'Coils', value: String(pklMetrics.coilsDone) },
      { label: 'Avg Speed', value: String(pklMetrics.avgLineSpeed) },
      { label: 'W / P', value: `${pklMetrics.wpW ?? 0} / ${pklMetrics.wpP ?? 0}` },
      { label: 'Repeats', value: String(pklMetrics.repeats) },
      { label: 'Chart', value: `${pklMetrics.chartReadings} / ${pklMetrics.chartDue}` },
    ];
  }, [pklMetrics]);
  const hrsShiftItems = useMemo(() => {
    if (!hrsMetrics) return [];
    return [
      { label: 'Produced MT', value: hrsMetrics.totalProdMt.toFixed(2) },
      { label: 'Input MT', value: hrsMetrics.targetMt.toFixed(2) },
      { label: 'Scrap MT', value: hrsMetrics.scrapMt.toFixed(2) },
      { label: 'Scrap %', value: hrsMetrics.scrapPct.toFixed(2) },
      { label: 'Coils Done', value: String(hrsMetrics.coilsDone) },
      { label: 'Settings', value: String(hrsMetrics.settingCount) },
    ];
  }, [hrsMetrics]);

  const running = useMemo(() => {
    const byStatus = queue.find((c) => c.status === 'IN_PROGRESS' || c.status === 'STOPPAGE');
    if (byStatus) return byStatus;
    if (activeCoilNo) return queue.find((c) => c.coilNo === activeCoilNo) ?? null;
    return null;
  }, [queue, activeCoilNo]);

  // After refresh, processStore is empty while queue shows IN_PROGRESS/STOPPAGE — hydrate from server order.
  useEffect(() => {
    if (!running) return;
    if (captureStatus === 'running' && runStartedAt) return;
    if (captureStatus === 'stoppage' && stoppageStartedAt) return;
    let cancelled = false;

    const hydrate = async () => {
      if (processCode === 'RWD' && running.batchNumber) {
        const { fetchRwdOrder } = await import('../../lib/rewindingWrites');
        const order = await fetchRwdOrder(running.batchNumber) as {
          status: string;
          coilNo?: string;
          prodStartAt?: string;
          activeStoppageId?: string;
          stoppages?: Array<{ startAt: string; endAt?: string }>;
        };
        if (cancelled) return;
        const open = order.stoppages?.find((s) => !s.endAt);
        hydrateProcessRun({
          coilNo: order.coilNo || running.coilNo,
          batchNumber: running.batchNumber,
          status: order.status,
          prodStartAt: order.prodStartAt,
          stoppageStartedAt: open?.startAt,
          activeStoppageId: order.activeStoppageId ?? null,
        });
        return;
      }
      if (processCode === 'HRS' || processCode === 'PKL') {
        const { fetchHrsPklOrder, orderToHydrateInput } = await import('../../lib/hrsPklWrites');
        const order = await fetchHrsPklOrder(processCode, running.coilNo);
        if (cancelled) return;
        hydrateProcessRun(orderToHydrateInput(order));
      }
    };

    void hydrate().catch(() => undefined);
    return () => { cancelled = true; };
  }, [
    processCode,
    running?.batchNumber,
    running?.coilNo,
    captureStatus,
    runStartedAt,
    stoppageStartedAt,
    hydrateProcessRun,
  ]);

  const upcoming = useMemo(
    () => queue.filter((c) => c.status === 'PENDING' || c.status === 'PREPARING'),
    [queue],
  );
  const nextOrder = upcoming[0] ?? null;

  const timerStart = captureStatus === 'stoppage'
    ? stoppageStartedAt
    : captureStatus === 'running'
      ? runStartedAt
      : undefined;
  const { formatted: wallRuntime } = useLiveTimer(timerStart ?? undefined);
  const netRuntime = useProcessNetTimer(
    runStartedAt,
    runStoppages,
    (processCode === 'PKL' || processCode === 'HRS') && captureStatus === 'running',
    activeStoppageId,
  );
  const runtime = (processCode === 'PKL' || processCode === 'HRS') && captureStatus === 'running'
    ? (netRuntime ?? wallRuntime)
    : wallRuntime;

  function openForm(coilNo: string, batchNumber?: string, orderStatus?: string) {
    if (processCode === 'RWD') {
      navigate(`${basePath}/rewinding/${encodeURIComponent(coilNo)}`, {
        state: {
          ...(batchNumber ? { batchNumber } : {}),
          ...(orderStatus ? { orderStatus } : {}),
        },
      });
      return;
    }
    navigate(`${basePath}/capture/${encodeURIComponent(coilNo)}`);
  }

  const runningStatusLabel =
    captureStatus === 'stoppage' ? 'STOPPAGE' : captureStatus === 'running' ? 'IN PROGRESS' : (running?.status.replace(/_/g, ' ') ?? '');
  const runningTone: Tone =
    captureStatus === 'stoppage' ? 'warning' : captureStatus === 'running' ? 'success' : 'info';
  const nextTone: Tone =
    nextOrder?.status === 'PENDING' ? 'accent' : nextOrder?.status === 'PREPARING' ? 'info' : 'muted';

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 gap-4 bg-secondary">
      <div>
        <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {config.label}
        </p>
        <h1 className="text-xl font-bold text-foreground">Live production status</h1>
        <p className="text-sm text-muted-foreground mt-0.5 font-mono tabular-nums">
          Shift · {producedMt ?? 0} / {targetMt ?? '—'} MT
        </p>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-auto">
        {(processCode === 'PKL' || processCode === 'HRS') && (
          <ProcessShiftSummaryPanel
            items={processCode === 'PKL' ? pklShiftItems : hrsShiftItems}
            loading={processCode === 'PKL' ? pklMetricsLoading : hrsMetricsLoading}
            footnote={!shiftLogId ? 'Shift log not ready yet.' : undefined}
          />
        )}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="bg-background border border-border rounded-lg overflow-hidden shadow-sm">
            <div className="bg-primary text-primary-foreground px-5 py-3 flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-90">
                Current Running Order
              </p>
              {running && <ZBadge tone={runningTone} label={runningStatusLabel} dot={captureStatus === 'running'} />}
            </div>
            {!running ? (
              <div className="p-6 text-center space-y-4">
                <p className="text-sm font-semibold text-foreground">No order is running</p>
                <p className="text-sm text-muted-foreground">
                  Start production from Orders to begin capture.
                </p>
                <ZButton variant="primary" onClick={() => navigate(basePath || '/')}>
                  <ArrowRight className="h-4 w-4" />
                  Go to Orders
                </ZButton>
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['Coil', running.displayCoilNo ?? running.coilNo],
                    ['Customer', running.customerName || '—'],
                    ['Grade', running.gradeCode || '—'],
                    ['Process', config.label],
                    ...(running.motherCoilNo ? [['Mother Coil', running.motherCoilNo] as const] : []),
                    ...(running.slitId ? [['Slit ID', running.slitId] as const] : []),
                    ['Width', `${running.widthMm} mm`],
                    ['Thickness', `${running.thicknessMm} mm`],
                    ['Weight', `${running.weightMt} MT`],
                    ['Start', runStartedAt ? formatPlantClock(runStartedAt) : '—'],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-card rounded-lg px-3 py-3 min-h-[64px]">
                      <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
                      <dd className="font-mono text-sm font-semibold text-foreground mt-1 break-all">{value}</dd>
                    </div>
                  ))}
                </dl>
                {timerStart && (
                  <p className="text-sm text-warning font-semibold">
                    Runtime: <span className="font-mono tabular-nums">{runtime}</span>
                    {captureStatus === 'stoppage' && <span className="text-destructive ml-2">(paused)</span>}
                  </p>
                )}
                <ZButton
                  variant="primary"
                  size="lg"
                  fullWidth
                  className="min-h-14"
                  onClick={() => openForm(running.coilNo, running.batchNumber, running.status)}
                >
                  <Play className="h-5 w-5" />
                  Open Production Form
                </ZButton>
              </div>
            )}
          </div>

          <div className="bg-background border border-border rounded-lg overflow-hidden shadow-sm">
            <div className="bg-card text-muted-foreground px-5 py-3 border-b border-border flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest">Upcoming Queue</p>
              <span className="text-xs font-semibold font-mono bg-background px-2 py-0.5 rounded-lg border border-border whitespace-nowrap shrink-0">
                {upcoming.length} orders
              </span>
            </div>
            {!nextOrder ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No pending orders in queue.
              </div>
            ) : (
              <div className="p-5 space-y-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  {[
                    ['Coil', nextOrder.displayCoilNo ?? nextOrder.coilNo],
                    ['Customer', nextOrder.customerName || '—'],
                    ['Grade', nextOrder.gradeCode || '—'],
                    ['Process', config.label],
                    ['Planned Quantity', `${nextOrder.weightMt} MT`],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-card rounded-lg px-3 py-3 min-h-[64px]">
                      <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
                      <dd className="font-mono text-sm font-semibold text-foreground mt-1 break-all">{value}</dd>
                    </div>
                  ))}
                  <div className="bg-card rounded-lg px-3 py-3 min-h-[64px]">
                    <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Status</dt>
                    <dd className="mt-1"><ZBadge tone={nextTone} label={nextOrder.status.replace(/_/g, ' ')} /></dd>
                  </div>
                </dl>
                {upcoming.length > 1 && (
                  <ul className="space-y-1 max-h-32 overflow-auto text-xs border-t border-border pt-3">
                    {upcoming.slice(1, 9).map((q) => (
                      <li key={q.coilNo} className="flex justify-between gap-2 text-muted-foreground">
                        <span className="font-mono truncate">{q.displayCoilNo ?? q.coilNo}</span>
                        <span className="font-mono tabular-nums">{q.weightMt} MT</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>

        <ShiftStoppageHistory stoppages={historyRows} />
      </div>
    </div>
  );
}
