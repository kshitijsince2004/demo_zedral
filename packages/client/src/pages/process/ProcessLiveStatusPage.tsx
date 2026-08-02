import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Play } from 'lucide-react';
import { ZButton } from '../../components/primitives/ZButton';
import { ShiftStoppageHistory } from '../../components/sixHi/ShiftStoppageHistory';
import { resolveStoppageDisplayCode } from '../../components/sixHi/SixHiStoppageCodes';
import { useProcessWorkspaceBase } from '../../hooks/useProcessWorkspaceBase';
import { apiClient } from '../../lib/apiClient';
import { getProcessConfig } from '../../lib/processConfig';
import { useProcessStore } from '../../store/processStore';
import { useShiftStore } from '../../store/shiftStore';
import { formatPlantClock } from '../../lib/dateFormat';
import { useLiveTimer } from '../../hooks/useLiveTimer';

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

/** 6HI-style Capture tab for process lines — running order, upcoming queue, stoppage history (no shift summary). */
export function ProcessLiveStatusPage({ processCode }: ProcessLiveStatusPageProps) {
  const navigate = useNavigate();
  const { basePath } = useProcessWorkspaceBase();
  const config = getProcessConfig(processCode);
  const { producedMt, targetMt, shiftLogId } = useShiftStore();
  const {
    queue,
    loadQueue,
    activeCoilNo,
    captureStatus,
    runStartedAt,
    stoppageStartedAt,
    hydrateRwdRun,
  } = useProcessStore();
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue, processCode]);

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

  const running = useMemo(() => {
    const byStatus = queue.find((c) => c.status === 'IN_PROGRESS' || c.status === 'STOPPAGE');
    if (byStatus) return byStatus;
    if (activeCoilNo) return queue.find((c) => c.coilNo === activeCoilNo) ?? null;
    return null;
  }, [queue, activeCoilNo]);

  // After refresh, processStore is empty while queue already shows IN_PROGRESS — hydrate from rwd_order.
  useEffect(() => {
    if (processCode !== 'RWD' || !running?.batchNumber) return;
    if (captureStatus === 'running' && runStartedAt) return;
    if (captureStatus === 'stoppage' && stoppageStartedAt) return;
    let cancelled = false;
    void import('../../lib/rewindingWrites')
      .then(({ fetchRwdOrder }) => fetchRwdOrder(running.batchNumber!))
      .then((order: {
        status: string;
        coilNo?: string;
        prodStartAt?: string;
        activeStoppageId?: string;
        stoppages?: Array<{ startAt: string; endAt?: string }>;
      }) => {
        if (cancelled) return;
        const open = order.stoppages?.find((s) => !s.endAt);
        hydrateRwdRun({
          coilNo: order.coilNo || running.coilNo,
          batchNumber: running.batchNumber,
          status: order.status,
          prodStartAt: order.prodStartAt,
          stoppageStartedAt: open?.startAt,
          activeStoppageId: order.activeStoppageId ?? null,
        });
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [
    processCode,
    running?.batchNumber,
    running?.coilNo,
    captureStatus,
    runStartedAt,
    stoppageStartedAt,
    hydrateRwdRun,
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
  const { formatted: runtime } = useLiveTimer(timerStart ?? undefined);

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

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 gap-4 bg-secondary/40">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          {config.label}
        </p>
        <h1 className="text-xl font-bold text-foreground">Live production status</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Shift · {producedMt ?? 0} / {targetMt ?? '—'} MT
        </p>
      </div>

      <div className="flex-1 min-h-0 flex flex-col gap-4 overflow-auto">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="bg-primary text-white px-5 py-3 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-widest opacity-90">
                Current Running Order
              </p>
              {running && (
                <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full bg-white/15">
                  {captureStatus === 'stoppage' ? 'Stoppage' : captureStatus === 'running' ? 'In Progress' : running.status.replace(/_/g, ' ')}
                </span>
              )}
            </div>
            {!running ? (
              <div className="p-6 text-center space-y-4">
                <p className="text-sm font-semibold text-foreground">No order is running</p>
                <p className="text-sm text-muted-foreground">
                  Start production from Orders to begin capture.
                </p>
                <ZButton variant="accent" onClick={() => navigate(basePath || '/')}>
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
                    <div key={label} className="bg-secondary rounded-xl px-3 py-3 min-h-[64px]">
                      <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</dt>
                      <dd className="font-mono text-sm font-semibold text-foreground mt-1 break-all">{value}</dd>
                    </div>
                  ))}
                </dl>
                {timerStart && (
                  <p className="text-sm text-amber-600 font-semibold">
                    Runtime: <span className="font-mono">{runtime}</span>
                    {captureStatus === 'stoppage' && <span className="text-destructive ml-2">(paused)</span>}
                  </p>
                )}
                <ZButton
                  variant="accent"
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

          <div className="bg-white border border-border rounded-2xl overflow-hidden shadow-sm">
            <div className="bg-muted text-muted-foreground px-5 py-3 border-b border-border flex items-center justify-between gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest">Upcoming Queue</p>
              <span className="text-xs font-semibold bg-white/50 px-2 py-0.5 rounded whitespace-nowrap shrink-0">
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
                    ['Status', nextOrder.status.replace(/_/g, ' ')],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-secondary rounded-xl px-3 py-3 min-h-[64px]">
                      <dt className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{label}</dt>
                      <dd className="font-mono text-sm font-semibold text-foreground mt-1 break-all">{value}</dd>
                    </div>
                  ))}
                </dl>
                {upcoming.length > 1 && (
                  <ul className="space-y-1 max-h-32 overflow-auto text-xs border-t border-border pt-3">
                    {upcoming.slice(1, 9).map((q) => (
                      <li key={q.coilNo} className="flex justify-between gap-2 text-muted-foreground">
                        <span className="font-mono truncate">{q.displayCoilNo ?? q.coilNo}</span>
                        <span>{q.weightMt} MT</span>
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
