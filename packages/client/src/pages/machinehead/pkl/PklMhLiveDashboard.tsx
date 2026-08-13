import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { DataFreshnessBadge } from '../../../components/DataFreshnessBadge';
import { OrderIdentityDisplay } from '../../../components/orders/OrderIdentityDisplay';
import { PklOrderDetailDrawer } from '../../../components/machinehead/pkl/PklOrderDetailDrawer';
import { PklMhSidePanel, type PklCoilDetail } from '../../../components/machinehead/pkl/PklMhSidePanel';
import { PklShiftReviewPanel } from '../../../components/process/PklShiftReviewPanel';
import { ZBadge } from '../../../components/primitives/ZBadge';
import { ZButton } from '../../../components/primitives/ZButton';
import { ZPillTabs } from '../../../components/ui/operator/ZPillTabs';
import { useLiveTimer } from '../../../hooks/useLiveTimer';
import { apiClient } from '../../../lib/apiClient';
import { currentPlantDate, formatPlantClock } from '../../../lib/dateFormat';
import {
  deleteHrsPklOrder,
  fetchPklManualStoppage,
  reinstateHrsPklOrder,
  type ProcessManualStoppageStatus,
} from '../../../lib/hrsPklWrites';
import { machineCrewService } from '../../../lib/machineCrewService';
import { formatOrderStatusLabel } from '../../../lib/orderLabels';
import {
  filterPklSearch,
  PKL_LIVE_TABS,
  PKL_ORDER_TABS,
  pklLineStatus,
  slicePklQueue,
  type PklChartRow,
  type PklLineStatus,
  type PklLiveTab,
} from '../../../lib/pklMhLiveSlice';
import { displayMotherCoilId } from '../../../lib/sixHiOrderIdentity';
import type { Tone } from '../../../lib/tones';
import {
  Panel,
  PanelBody,
  PanelHeader,
  StoppageDurationCell,
} from '../../live/MachineHeadDashboardPanels';
import type { ProcessQueueCard } from '../../../store/processStore';
import { PklMhProcessReadingsSection } from './PklMhProcessReadingsSection';

type PklHistoryRow = {
  id: string;
  coilNo: string;
  gradeCode?: string | null;
  weightMt?: number | null;
  lineSpeedMpm?: number | null;
  wp?: string | null;
  repeats?: number | null;
  endFilling?: boolean | null;
  status?: string;
  shiftCode?: string;
};

type PklStoppageRow = {
  id: string;
  categoryLabel?: string;
  startAt?: string;
  endAt?: string;
  durationMin?: number;
  remarks?: string;
};

const STATUS_HEADER: Record<PklLineStatus, { bg: string; label: string }> = {
  RUNNING: { bg: 'bg-success', label: 'Running' },
  IDLE: { bg: 'bg-primary', label: 'Idle' },
  STOPPAGE: { bg: 'bg-warning', label: 'Stoppage' },
};

function statusTone(status: string): Tone {
  const u = status.toUpperCase();
  if (u === 'PENDING' || u === 'HOLD') return 'accent';
  if (u === 'IN_PROGRESS') return 'success';
  if (u === 'STOPPAGE') return 'warning';
  if (u === 'PREPARING') return 'info';
  if (u === 'REJECTED') return 'destructive';
  return 'muted';
}

function identity(card: ProcessQueueCard) {
  return {
    batchNumber: card.batchNumber ?? card.coilNo,
    coilNo: card.coilNo,
    motherCoilNo: card.motherCoilNo,
    slitId: card.slitId,
    displayCoilNo: card.displayCoilNo,
  };
}

function RunningOrderCard({
  status,
  running,
  operatorName,
  prodStartAt,
  stoppageLabel,
  onOpenOrders,
  onOpenDetail,
}: {
  status: PklLineStatus;
  running: ProcessQueueCard | null;
  operatorName: string;
  prodStartAt?: string;
  stoppageLabel?: string;
  onOpenOrders: () => void;
  onOpenDetail: () => void;
}) {
  const cfg = STATUS_HEADER[status];
  const ticking = status === 'RUNNING' || status === 'STOPPAGE';
  const { formatted } = useLiveTimer(prodStartAt, ticking && !!prodStartAt);

  return (
    <div className="border border-border rounded-lg bg-card shadow-sm overflow-hidden">
      <div className={`px-4 py-3 flex items-center justify-between ${cfg.bg}`}>
        <span className="font-bold text-sm tracking-wide text-white">PKL</span>
        <span className="text-[9px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-white/20 text-white">
          {cfg.label}
        </span>
      </div>
      {!running ? (
        <div className="p-6 text-center space-y-3">
          <p className="text-sm font-semibold text-foreground">No order is running</p>
          <p className="text-sm text-muted-foreground">Start production from Orders when a coil is ready.</p>
          <ZButton variant="primary" onClick={onOpenOrders}>Go to Orders</ZButton>
        </div>
      ) : (
        <div className="p-5 space-y-4">
          {formatted && (
            <p className="text-2xl font-mono font-bold tabular-nums text-success">
              {formatted}
              <span className="ml-2 text-[9px] font-bold uppercase tracking-widest text-success">Runtime</span>
            </p>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              ['Operator', operatorName || '—'],
              ['Coil', displayMotherCoilId(running)],
              ['Customer', running.customerName || '—'],
              ['Grade', running.gradeCode || '—'],
              ['Process', 'Pickling'],
              ['Route', running.routeRaw || '—'],
              ['Width', running.widthMm != null ? `${running.widthMm} mm` : '—'],
              ['Thickness', running.thicknessMm != null ? `${running.thicknessMm} mm` : '—'],
              ['Weight', `${Number(running.weightMt ?? 0).toFixed(2)} MT`],
              ['Start', prodStartAt ? formatPlantClock(prodStartAt) : '—'],
            ].map(([label, value]) => (
              <div key={label} className="bg-card rounded-lg px-3 py-3 min-h-[64px] border border-border/60">
                <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
                <dd className="font-mono text-sm font-semibold text-foreground mt-1 break-all">{value}</dd>
              </div>
            ))}
          </dl>
          {stoppageLabel && <p className="text-sm text-warning">{stoppageLabel}</p>}
          <ZButton variant="primary" fullWidth onClick={onOpenDetail}>Open coil detail</ZButton>
        </div>
      )}
    </div>
  );
}

/** PKL MH Live — CRM chrome; six tabs with shift review and process readings. */
export function PklMhLiveDashboard() {
  const [tab, setTab] = useState<PklLiveTab>('overview');
  const [queue, setQueue] = useState<ProcessQueueCard[]>([]);
  const [stoppage, setStoppage] = useState<ProcessManualStoppageStatus | null>(null);
  const [shiftLogId, setShiftLogId] = useState<string | null>(null);
  const [operatorName, setOperatorName] = useState('—');
  const [selectedCoil, setSelectedCoil] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [detailByCoil, setDetailByCoil] = useState<Record<string, PklCoilDetail>>({});
  const [detailLoadingCoil, setDetailLoadingCoil] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'pkl' | 'complete'>('pkl');
  const [drawerCard, setDrawerCard] = useState<ProcessQueueCard | null>(null);

  const [historyRows, setHistoryRows] = useState<PklHistoryRow[]>([]);
  const [stoppages, setStoppages] = useState<PklStoppageRow[]>([]);
  const [historyDate, setHistoryDate] = useState(currentPlantDate());
  const [datedHistory, setDatedHistory] = useState<PklHistoryRow[]>([]);

  const [tankDate, setTankDate] = useState(currentPlantDate());
  const [chartRows, setChartRows] = useState<PklChartRow[]>([]);
  const [readingLabels, setReadingLabels] = useState(['1st', '3rd', '5th', '7th']);
  const [tankLoading, setTankLoading] = useState(false);
  const [tankError, setTankError] = useState<string | null>(null);

  const loadCoilDetail = useCallback(async (coilNo: string, force = false) => {
    if (!force) {
      let cached: PklCoilDetail | undefined;
      setDetailByCoil((prev) => {
        cached = prev[coilNo];
        return prev;
      });
      if (cached) return cached;
    }
    setDetailLoadingCoil(coilNo);
    try {
      const [order, entry] = await Promise.all([
        apiClient.get<PklCoilDetail['order']>(`/pkl-order/orders/${encodeURIComponent(coilNo)}`).catch(() => null),
        apiClient.get<PklCoilDetail['entry']>(`/stations/pkl/entry/${encodeURIComponent(coilNo)}`).catch(() => null),
      ]);
      const detail: PklCoilDetail = { order, entry };
      setDetailByCoil((prev) => ({ ...prev, [coilNo]: detail }));
      return detail;
    } finally {
      setDetailLoadingCoil((cur) => (cur === coilNo ? null : cur));
    }
  }, []);

  const openDrawer = useCallback((mode: 'pkl' | 'complete', card: ProcessQueueCard) => {
    setDrawerCard(card);
    setDrawerMode(mode);
    setDrawerOpen(true);
    void loadCoilDetail(card.coilNo);
  }, [loadCoilDetail]);

  const reload = useCallback(async () => {
    try {
      const [q, st, active] = await Promise.all([
        apiClient.get<{ queue: ProcessQueueCard[] }>('/pkl-order/queue'),
        fetchPklManualStoppage().catch(() => null),
        apiClient.get<{ shiftLogId?: string }>('/shift-logs/active/PKL').catch(() => ({ shiftLogId: undefined })),
      ]);
      setQueue(q.queue ?? []);
      setStoppage(st);
      setShiftLogId(active.shiftLogId ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load PKL queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, [reload]);

  useEffect(() => {
    void machineCrewService.list('PKL')
      .then((res) => {
        const names = (res.crew ?? []).map((c) => c.memberName).filter(Boolean);
        setOperatorName(names[0] ?? '—');
      })
      .catch(() => setOperatorName('—'));
    void apiClient.get<{ config: { reading_labels?: string[] } | null }>('/stations/pkl/chart-config')
      .then((cfg) => {
        if (Array.isArray(cfg.config?.reading_labels)) {
          setReadingLabels(cfg.config.reading_labels.map(String));
        }
      })
      .catch(() => undefined);
  }, []);

  const running = useMemo(
    () => queue.find((c) => c.status === 'IN_PROGRESS' || c.status === 'STOPPAGE') ?? null,
    [queue],
  );
  const lineStatus = pklLineStatus(queue, !!stoppage?.active);

  const selected = useMemo(
    () => queue.find((c) => c.coilNo === selectedCoil) ?? null,
    [queue, selectedCoil],
  );

  useEffect(() => {
    const coilNo = selected?.coilNo ?? running?.coilNo;
    if (!coilNo) return;
    void loadCoilDetail(coilNo);
  }, [selected?.coilNo, running?.coilNo, loadCoilDetail]);

  useEffect(() => {
    if (!shiftLogId) {
      setHistoryRows([]);
      setStoppages([]);
      return;
    }
    if (tab === 'production') {
      void apiClient.get<{ orders: PklHistoryRow[] }>(
        `/stations/pkl/history?shiftLogId=${encodeURIComponent(shiftLogId)}`,
      )
        .then((res) => setHistoryRows(res.orders ?? []))
        .catch(() => setHistoryRows([]));
    }
    if (tab === 'stoppages') {
      void apiClient.get<PklStoppageRow[]>(
        `/stations/pkl/shift/${encodeURIComponent(shiftLogId)}/stoppages`,
      )
        .then((rows) => setStoppages(Array.isArray(rows) ? rows : []))
        .catch(() => setStoppages([]));
    }
  }, [shiftLogId, tab]);

  useEffect(() => {
    if (tab !== 'completed') return;
    let cancelled = false;
    void (async () => {
      try {
        const qs = new URLSearchParams({ shiftDate: historyDate, line: 'PKL' });
        const logs = await apiClient.get<Array<{ id: string; shiftCode?: string }>>(`/shift-logs?${qs.toString()}`);
        const packs = await Promise.all(
          logs.map((log) =>
            apiClient
              .get<{ orders: PklHistoryRow[] }>(
                `/stations/pkl/history?shiftLogId=${encodeURIComponent(log.id)}`,
              )
              .catch(() => ({ orders: [] as PklHistoryRow[] })),
          ),
        );
        const seen = new Set<string>();
        const out: PklHistoryRow[] = [];
        for (const pack of packs) {
          for (const o of pack.orders ?? []) {
            const key = o.id || o.coilNo;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(o);
          }
        }
        if (!cancelled) setDatedHistory(out);
      } catch {
        if (!cancelled) setDatedHistory([]);
      }
    })();
    return () => { cancelled = true; };
  }, [tab, historyDate]);

  const loadTankRows = useCallback(async (date: string) => {
    setTankLoading(true);
    setTankError(null);
    try {
      const qs = new URLSearchParams({ line: 'PKL', shiftDate: date });
      const logs = await apiClient.get<Array<{ id: string; shiftCode?: string }>>(`/shift-logs?${qs.toString()}`);
      if (logs.length === 0) {
        setChartRows([]);
        return;
      }
      const packs = await Promise.all(
        logs.map(async (log) => {
          const ch = await apiClient.get<{ rows: PklChartRow[] }>(
            `/stations/pkl/chart/${encodeURIComponent(log.id)}`,
          );
          return (ch.rows ?? []).map((r) => ({
            ...r,
            shiftCode: log.shiftCode ?? '?',
          }));
        }),
      );
      setChartRows(packs.flat());
    } catch (e) {
      setTankError(e instanceof Error ? e.message : 'Tank readings failed');
      setChartRows([]);
    } finally {
      setTankLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'overview') return;
    void loadTankRows(tankDate);
  }, [tab, tankDate, loadTankRows]);

  const tableRows = useMemo(() => {
    const sliced = slicePklQueue(queue, tab);
    return filterPklSearch(sliced, search);
  }, [queue, tab, search]);

  const prodRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return historyRows;
    return historyRows.filter((r) => `${r.coilNo} ${r.gradeCode ?? ''}`.toLowerCase().includes(q));
  }, [historyRows, search]);

  const datedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return datedHistory;
    return datedHistory.filter((r) => `${r.coilNo} ${r.gradeCode ?? ''}`.toLowerCase().includes(q));
  }, [datedHistory, search]);

  async function handleReinstate(coilNo: string, batchNumber?: string) {
    setBusy(true);
    setError(null);
    try {
      await reinstateHrsPklOrder('PKL', coilNo, 'PREPARING', { batchNumber });
      setSelectedCoil(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reinstate failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(coilNo: string) {
    setBusy(true);
    setError(null);
    try {
      await deleteHrsPklOrder('PKL', coilNo);
      setSelectedCoil(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  const showOrderPanel = PKL_ORDER_TABS.includes(tab);
  const st = (selected?.status ?? '').toUpperCase();
  const canReinstate = st === 'REJECTED' || st === 'HOLD' || st === 'COMPLETED';
  const canDelete = st === 'COMPLETED';

  const side = (
    <PklMhSidePanel
      card={selected}
      detail={selected ? detailByCoil[selected.coilNo] ?? null : null}
      detailLoading={!!selected && detailLoadingCoil === selected.coilNo}
      busy={busy}
      onShowPklDetails={() => selected && openDrawer('pkl', selected)}
      onShowCompleteInfo={() => selected && openDrawer('complete', selected)}
      onReinstatePreparing={canReinstate && selected ? () => void handleReinstate(selected.coilNo, selected.batchNumber) : undefined}
      onDelete={canDelete && selected ? () => void handleDelete(selected.coilNo) : undefined}
    />
  );

  let tabContent: ReactNode;
  if (loading && queue.length === 0) {
    tabContent = <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>;
  } else if (tab === 'overview') {
    tabContent = (
      <div className="grid grid-cols-1 gap-4">
        <RunningOrderCard
          status={lineStatus}
          running={running}
          operatorName={operatorName}
          prodStartAt={running ? detailByCoil[running.coilNo]?.order?.prodStartAt : undefined}
          stoppageLabel={stoppage?.active
            ? (stoppage.active.categoryLabel ?? stoppage.active.reason ?? 'Manual stoppage')
            : undefined}
          onOpenOrders={() => setTab('orders')}
          onOpenDetail={() => {
            if (!running) return;
            setSelectedCoil(running.coilNo);
            openDrawer('pkl', running);
          }}
        />
        <PklShiftReviewPanel shiftLogId={shiftLogId} variant="compact" />
        <PklMhProcessReadingsSection
          tankDate={tankDate}
          onTankDateChange={setTankDate}
          chartRows={chartRows}
          readingLabels={readingLabels}
          loading={tankLoading}
          error={tankError}
        />
      </div>
    );
  } else if (tab === 'production') {
    tabContent = (
      <Panel>
        <PanelHeader title="Production History - This Shift" />
        <PanelBody empty={prodRows.length === 0} emptyLabel="No production this shift">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2">Coil</th>
                <th>Grade</th>
                <th>Weight</th>
                <th>Speed</th>
                <th>W/P</th>
                <th>Repeats</th>
                <th>End fill</th>
              </tr>
            </thead>
            <tbody>
              {prodRows.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-border hover:bg-secondary/50 cursor-pointer ${selectedCoil === r.coilNo ? 'bg-primary/10' : ''}`}
                  onClick={() => setSelectedCoil(r.coilNo)}
                >
                  <td className="px-4 py-3 font-mono font-bold">{r.coilNo}</td>
                  <td>{r.gradeCode ?? '—'}</td>
                  <td className="font-mono">{r.weightMt != null ? Number(r.weightMt).toFixed(2) : '—'} MT</td>
                  <td className="font-mono">{r.lineSpeedMpm ?? '—'}</td>
                  <td className="font-mono">{r.wp ?? '—'}</td>
                  <td className="font-mono">{r.repeats ?? '—'}</td>
                  <td className="font-mono">{r.endFilling === true ? 'Yes' : r.endFilling === false ? 'No' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PanelBody>
      </Panel>
    );
  } else if (tab === 'stoppages') {
    tabContent = (
      <Panel>
        <PanelHeader title="Stoppage History - This Shift" />
        <PanelBody empty={stoppages.length === 0 && !stoppage?.active} emptyLabel="No stoppages for this shift">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2">Reason</th>
                <th>Start</th>
                <th>Duration</th>
                <th>Remarks</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stoppage?.active && (
                <tr className="border-t border-border">
                  <td className="px-4 py-3">{stoppage.active.categoryLabel ?? stoppage.active.reason ?? 'Manual stoppage'}</td>
                  <td>{formatPlantClock(stoppage.active.startedAt)}</td>
                  <td><StoppageDurationCell startAt={stoppage.active.startedAt} active /></td>
                  <td className="text-muted-foreground">—</td>
                  <td className="text-destructive font-medium">Active</td>
                </tr>
              )}
              {stoppages.map((s) => (
                <tr key={s.id} className="border-t border-border">
                  <td className="px-4 py-3">{s.categoryLabel ?? 'Stoppage'}</td>
                  <td>{s.startAt ? formatPlantClock(s.startAt) : '—'}</td>
                  <td>
                    <StoppageDurationCell startAt={s.startAt} active={!s.endAt} durationMin={s.durationMin} />
                  </td>
                  <td className="text-muted-foreground">{s.remarks ?? '—'}</td>
                  <td className={s.endAt ? 'text-muted-foreground' : 'text-destructive font-medium'}>
                    {s.endAt ? 'Ended' : 'Active'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </PanelBody>
      </Panel>
    );
  } else if (tab === 'completed') {
    tabContent = (
      <Panel>
        <PanelHeader title="History" />
        <PanelBody empty={datedRows.length === 0} emptyLabel="No completed history for this date">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2">Coil</th>
                <th>Grade</th>
                <th>Weight</th>
                <th>Shift</th>
              </tr>
            </thead>
            <tbody>
              {datedRows.map((r) => (
                <tr
                  key={r.id}
                  className={`border-t border-border hover:bg-secondary/50 cursor-pointer ${selectedCoil === r.coilNo ? 'bg-primary/10' : ''}`}
                  onClick={() => setSelectedCoil(r.coilNo)}
                >
                  <td className="px-4 py-3 font-mono font-bold">{r.coilNo}</td>
                  <td>{r.gradeCode ?? '—'}</td>
                  <td className="font-mono">{r.weightMt != null ? Number(r.weightMt).toFixed(2) : '—'} MT</td>
                  <td className="font-mono">{r.shiftCode ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </PanelBody>
      </Panel>
    );
  } else {
    const emptyLabel = tab === 'rejected' ? 'No orders on hold' : 'No pending or preparing orders';
    tabContent = (
      <Panel>
        <PanelHeader title={tab === 'rejected' ? 'Order Hold' : 'Pending & Preparing Orders'} />
        <PanelBody empty={tableRows.length === 0} emptyLabel={emptyLabel}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2">Order / Coil</th>
                <th>Customer</th>
                <th>Grade</th>
                <th>Weight</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tableRows.map((c) => (
                <tr
                  key={c.coilNo}
                  className={`border-t border-border hover:bg-secondary/50 cursor-pointer ${selectedCoil === c.coilNo ? 'bg-primary/10' : ''}`}
                  onClick={() => setSelectedCoil(c.coilNo)}
                >
                  <td className="px-4 py-3">
                    <OrderIdentityDisplay order={identity(c)} size="sm" showSubtitle={false} />
                  </td>
                  <td>{c.customerName || '—'}</td>
                  <td className="font-mono">{c.gradeCode || '—'}</td>
                  <td className="font-mono">{Number(c.weightMt ?? 0).toFixed(2)} MT</td>
                  <td><ZBadge tone={statusTone(c.status)} label={formatOrderStatusLabel(c.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </PanelBody>
      </Panel>
    );
  }

  return (
    <MachineHeadShell
      title="PKL Live Dashboard"
      subtitle="Pickling — live queue"
      fillViewport
      onRefresh={() => void reload()}
      headerActions={<DataFreshnessBadge />}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive shrink-0">
            {error}
          </div>
        )}
        <div className="z-card shrink-0 flex flex-col gap-2.5 p-2.5">
          <div className="overflow-x-auto">
            <ZPillTabs
              tabs={[...PKL_LIVE_TABS]}
              activeId={tab}
              onChange={(id) => setTab(id as PklLiveTab)}
              className="min-w-max"
            />
          </div>
          {tab !== 'overview' && tab !== 'stoppages' && (
            <div className="flex flex-wrap items-center gap-2">
              {tab === 'completed' && (
                <label className="text-xs font-medium text-muted-foreground">
                  Date
                  <input
                    type="date"
                    value={historyDate}
                    onChange={(e) => setHistoryDate(e.target.value || currentPlantDate())}
                    className="ml-2 rounded-lg border border-border bg-white px-2 py-1.5 text-sm font-mono tabular-nums"
                  />
                </label>
              )}
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search coil, customer, grade…"
                className="rounded-lg border border-border bg-white px-3 py-1.5 text-sm min-w-[12rem] max-w-xs"
                aria-label="Search PKL orders"
              />
            </div>
          )}
        </div>
        <div
          className={[
            'flex-1 min-h-0 grid gap-4',
            showOrderPanel ? 'xl:grid-cols-[1fr_minmax(280px,320px)]' : 'grid-cols-1',
          ].join(' ')}
        >
          <div className="min-h-0 overflow-y-auto pr-1">{tabContent}</div>
          {showOrderPanel && (
            <aside className="hidden xl:block self-start sticky top-0 w-full max-h-full overflow-y-auto">
              {side}
            </aside>
          )}
        </div>
        {showOrderPanel && (
          <div className="xl:hidden shrink-0 max-h-[40vh] overflow-hidden">{side}</div>
        )}
      </div>
      <PklOrderDetailDrawer
        card={drawerCard}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        mode={drawerMode}
        cachedDetail={drawerCard ? detailByCoil[drawerCard.coilNo] : null}
      />
    </MachineHeadShell>
  );
}
