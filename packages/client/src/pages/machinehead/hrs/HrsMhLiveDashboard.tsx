import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { HrsOrderDetailDrawer } from '../../../components/machinehead/hrs/HrsOrderDetailDrawer';
import { HrsSidePanel, type HrsCoilDetail } from '../../../components/machinehead/hrs/HrsSidePanel';
import { DataFreshnessBadge } from '../../../components/DataFreshnessBadge';
import { OrderIdentityDisplay } from '../../../components/orders/OrderIdentityDisplay';
import { ZBadge } from '../../../components/primitives/ZBadge';
import { ZButton } from '../../../components/primitives/ZButton';
import { ZPillTabs } from '../../../components/ui/operator/ZPillTabs';
import { apiClient } from '../../../lib/apiClient';
import { currentPlantDate, formatPlantClock, formatPlantDateTime } from '../../../lib/dateFormat';
import {
  deleteHrsPklOrder,
  fetchHrsManualStoppage,
  reinstateHrsPklOrder,
  type ProcessManualStoppageStatus,
} from '../../../lib/hrsPklWrites';
import {
  filterHrsSearch,
  hrsLineStatus,
  HRS_LIVE_TABS,
  HRS_ORDER_TABS,
  sliceHrsQueue,
  type HrsLiveTab,
} from '../../../lib/hrsMhLiveSlice';
import { machineCrewService } from '../../../lib/machineCrewService';
import { formatOrderStatusLabel } from '../../../lib/orderLabels';
import { bootstrapShiftContext } from '../../../lib/shiftDetection';
import { displayMotherCoilId } from '../../../lib/sixHiOrderIdentity';
import type { Tone } from '../../../lib/tones';
import { useLiveTimer } from '../../../hooks/useLiveTimer';
import {
  Panel,
  PanelBody,
  PanelHeader,
  StatCell,
  StoppageDurationCell,
} from '../../live/MachineHeadDashboardPanels';
import type { ProcessQueueCard } from '../../../store/processStore';

type HrsMetrics = {
  targetMt: number;
  totalProdMt: number;
  scrapMt: number;
  scrapPct: number;
  coilsDone: number;
  settingCount: number;
};

type HrsHistoryRow = {
  id: string;
  coilNo: string;
  gradeCode?: string | null;
  weightMt?: number | null;
  scrapMt?: number | null;
  status?: string;
  timeFrom?: string | null;
  timeTo?: string | null;
};

type HrsStoppageRow = {
  id: string;
  categoryLabel?: string;
  startAt?: string;
  endAt?: string;
  durationMin?: number;
  remarks?: string;
};

const STATUS_HEADER: Record<'RUNNING' | 'IDLE' | 'STOPPAGE', { bg: string; label: string }> = {
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

function hrsRowKey(card: ProcessQueueCard): string {
  return card.journeyId || `${card.coilNo}:${card.slitId ?? ''}:${card.batchNumber ?? ''}`;
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
  status: 'RUNNING' | 'IDLE' | 'STOPPAGE';
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
        <span className="font-bold text-sm tracking-wide text-white">HRS</span>
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
              ['Process', 'HR Slitting'],
              ['Width', running.widthMm != null ? `${running.widthMm} mm` : '—'],
              ['Thickness', running.thicknessMm != null ? `${running.thicknessMm} mm` : '—'],
              ['Weight', `${Number(running.weightMt ?? 0).toFixed(2)} MT`],
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

/** HRS MH Live — CRM chrome, HRS APIs only. */
export function HrsMhLiveDashboard() {
  const [tab, setTab] = useState<HrsLiveTab>('overview');
  const [queue, setQueue] = useState<ProcessQueueCard[]>([]);
  const [stoppage, setStoppage] = useState<ProcessManualStoppageStatus | null>(null);
  const [metrics, setMetrics] = useState<HrsMetrics | null>(null);
  const [history, setHistory] = useState<HrsHistoryRow[]>([]);
  const [stoppages, setStoppages] = useState<HrsStoppageRow[]>([]);
  const [operatorName, setOperatorName] = useState('—');
  const [shiftLogId, setShiftLogId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailByCoil, setDetailByCoil] = useState<Record<string, HrsCoilDetail>>({});
  const [detailLoadingCoil, setDetailLoadingCoil] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerMode, setDrawerMode] = useState<'hrs' | 'complete'>('hrs');
  const [drawerCard, setDrawerCard] = useState<ProcessQueueCard | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyDate, setHistoryDate] = useState(currentPlantDate());
  const [datedHistory, setDatedHistory] = useState<HrsHistoryRow[]>([]);

  const loadCoilDetail = useCallback(async (coilNo: string, force = false) => {
    if (!force) {
      let cached: HrsCoilDetail | undefined;
      setDetailByCoil((prev) => {
        cached = prev[coilNo];
        return prev;
      });
      if (cached) return cached;
    }
    setDetailLoadingCoil(coilNo);
    try {
      const [order, entry] = await Promise.all([
        apiClient.get<HrsCoilDetail['order']>(`/hrs-order/orders/${encodeURIComponent(coilNo)}`).catch(() => null),
        apiClient.get<HrsCoilDetail['entry']>(`/stations/hrs/entry/${encodeURIComponent(coilNo)}`).catch(() => null),
      ]);
      const detail: HrsCoilDetail = { order, entry };
      setDetailByCoil((prev) => ({ ...prev, [coilNo]: detail }));
      return detail;
    } finally {
      setDetailLoadingCoil((cur) => (cur === coilNo ? null : cur));
    }
  }, []);

  const openDrawer = useCallback((mode: 'hrs' | 'complete', card: ProcessQueueCard) => {
    setDrawerCard(card);
    setDrawerMode(mode);
    setDrawerOpen(true);
    void loadCoilDetail(card.coilNo);
  }, [loadCoilDetail]);

  const reload = useCallback(async () => {
    try {
      const [q, st] = await Promise.all([
        apiClient.get<{ queue: ProcessQueueCard[] }>('/hrs-order/queue'),
        fetchHrsManualStoppage().catch(() => null),
      ]);
      setQueue(q.queue ?? []);
      setStoppage(st);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load HRS queue');
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
    void (async () => {
      try {
        await bootstrapShiftContext('HRS');
        const active = await apiClient.get<{ shiftLogId?: string }>('/shift-logs/active/HRS');
        const id = active.shiftLogId ?? null;
        setShiftLogId(id);
        if (!id) {
          setMetrics(null);
          return;
        }
        const m = await apiClient.get<HrsMetrics>(`/stations/hrs/shift-metrics/${encodeURIComponent(id)}`);
        setMetrics(m);
      } catch {
        setShiftLogId(null);
        setMetrics(null);
      }
    })();
    void machineCrewService.list('HRS')
      .then((res) => {
        const names = (res.crew ?? []).map((c) => c.memberName).filter(Boolean);
        setOperatorName(names[0] ?? '—');
      })
      .catch(() => setOperatorName('—'));
  }, []);

  useEffect(() => {
    if (!shiftLogId) {
      setHistory([]);
      setStoppages([]);
      return;
    }
    if (tab !== 'production' && tab !== 'stoppages') return;
    if (tab === 'production') {
      void apiClient.get<{ orders: HrsHistoryRow[] }>(
        `/stations/hrs/history?shiftLogId=${encodeURIComponent(shiftLogId)}`,
      )
        .then((res) => setHistory((res.orders ?? []).filter((o) => (o.status ?? '').toUpperCase() !== 'REJECTED')))
        .catch(() => setHistory([]));
    }
    if (tab === 'stoppages') {
      void apiClient.get<HrsStoppageRow[]>(
        `/stations/hrs/shift/${encodeURIComponent(shiftLogId)}/stoppages`,
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
        const qs = new URLSearchParams({ shiftDate: historyDate, line: 'HRS' });
        const logs = await apiClient.get<Array<{ id: string }>>(`/shift-logs?${qs.toString()}`);
        const packs = await Promise.all(
          logs.map((log) =>
            apiClient
              .get<{ orders: HrsHistoryRow[] }>(
                `/stations/hrs/history?shiftLogId=${encodeURIComponent(log.id)}`,
              )
              .catch(() => ({ orders: [] as HrsHistoryRow[] })),
          ),
        );
        const seen = new Set<string>();
        const out: HrsHistoryRow[] = [];
        for (const pack of packs) {
          for (const o of pack.orders ?? []) {
            const s = (o.status ?? '').toUpperCase();
            if (s === 'REJECTED' || s === 'HOLD') continue;
            const key = `${o.id || o.coilNo}:${(o as { slitId?: string }).slitId ?? ''}`;
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

  const running = useMemo(
    () => queue.find((c) => c.status === 'IN_PROGRESS' || c.status === 'STOPPAGE') ?? null,
    [queue],
  );
  const status = hrsLineStatus(queue, !!stoppage?.active);

  const selected = useMemo(
    () => queue.find((c) => hrsRowKey(c) === selectedKey) ?? null,
    [queue, selectedKey],
  );

  useEffect(() => {
    const coilNo = selected?.coilNo ?? running?.coilNo;
    if (!coilNo) return;
    void loadCoilDetail(coilNo);
  }, [selected?.coilNo, running?.coilNo, loadCoilDetail]);

  const selectedDetail = selected?.coilNo ? detailByCoil[selected.coilNo] ?? null : null;
  const runningDetail = running?.coilNo ? detailByCoil[running.coilNo] : null;

  const tableRows = useMemo(() => {
    const sliced = sliceHrsQueue(queue, tab);
    return filterHrsSearch(sliced, search);
  }, [queue, tab, search]);

  const prodRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return history;
    return history.filter((r) => `${r.coilNo} ${r.gradeCode ?? ''}`.toLowerCase().includes(q));
  }, [history, search]);

  const datedRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return datedHistory;
    return datedHistory.filter((r) => `${r.coilNo} ${r.gradeCode ?? ''}`.toLowerCase().includes(q));
  }, [datedHistory, search]);

  async function handleReinstate(card: ProcessQueueCard) {
    setBusy(true);
    setError(null);
    try {
      await reinstateHrsPklOrder('HRS', card.coilNo, 'PREPARING', {
        slitId: card.slitId,
        batchNumber: card.batchNumber,
      });
      setSelectedKey(null);
      setDetailByCoil((prev) => {
        const next = { ...prev };
        delete next[card.coilNo];
        return next;
      });
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
      await deleteHrsPklOrder('HRS', coilNo);
      setSelectedKey(null);
      setDetailByCoil((prev) => {
        const next = { ...prev };
        delete next[coilNo];
        return next;
      });
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  const showOrderPanel = HRS_ORDER_TABS.includes(tab);
  const st = (selected?.status ?? '').toUpperCase();
  const canReinstate = st === 'REJECTED' || st === 'HOLD' || st === 'COMPLETED';
  const canDelete = st === 'COMPLETED';

  const side = (
    <HrsSidePanel
      card={selected}
      detail={selectedDetail}
      detailLoading={!!selected?.coilNo && detailLoadingCoil === selected.coilNo}
      busy={busy}
      onShowHrsDetails={() => selected && openDrawer('hrs', selected)}
      onShowCompleteInfo={() => selected && openDrawer('complete', selected)}
      onReinstatePreparing={canReinstate && selected ? () => void handleReinstate(selected) : undefined}
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
          status={status}
          running={running}
          operatorName={operatorName}
          prodStartAt={runningDetail?.order?.prodStartAt}
          stoppageLabel={stoppage?.active
            ? (stoppage.active.categoryLabel ?? stoppage.active.reason ?? 'Manual stoppage')
            : undefined}
          onOpenOrders={() => setTab('orders')}
          onOpenDetail={() => {
            if (!running) return;
            setSelectedKey(hrsRowKey(running));
            openDrawer('hrs', running);
          }}
        />
        <Panel>
          <PanelHeader title="Shift Summary" />
          <PanelBody empty={!metrics} emptyLabel={shiftLogId ? 'No metrics yet' : 'Shift log not ready yet'}>
            {metrics && (
              <dl className="grid grid-cols-2 sm:grid-cols-3">
                <StatCell label="Target MT" value={metrics.targetMt.toFixed(2)} mono />
                <StatCell label="Production MT" value={metrics.totalProdMt.toFixed(2)} mono />
                <StatCell label="Scrap MT" value={metrics.scrapMt.toFixed(2)} mono />
                <StatCell label="Scrap %" value={`${metrics.scrapPct}%`} mono />
                <StatCell label="Coils" value={metrics.coilsDone} />
                <StatCell label="Settings" value={metrics.settingCount} />
              </dl>
            )}
          </PanelBody>
        </Panel>
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
                <th>Scrap</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {prodRows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-border hover:bg-secondary/50 cursor-pointer"
                  onClick={() => setSelectedKey(r.coilNo)}
                >
                  <td className="px-4 py-3 font-mono font-bold">{r.coilNo}</td>
                  <td>{r.gradeCode ?? '—'}</td>
                  <td className="font-mono">{r.weightMt != null ? Number(r.weightMt).toFixed(2) : '—'} MT</td>
                  <td className="font-mono">{r.scrapMt != null ? Number(r.scrapMt).toFixed(2) : '—'}</td>
                  <td className="text-muted-foreground">{r.timeTo ? formatPlantDateTime(r.timeTo) : '—'}</td>
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
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {stoppage?.active && (
                <tr className="border-t border-border">
                  <td className="px-4 py-3">{stoppage.active.categoryLabel ?? stoppage.active.reason ?? 'Manual stoppage'}</td>
                  <td>{formatPlantClock(stoppage.active.startedAt)}</td>
                  <td><StoppageDurationCell startAt={stoppage.active.startedAt} active /></td>
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
        <PanelBody empty={datedRows.length === 0} emptyLabel="No completed history">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="px-4 py-2">Coil</th>
                <th>Grade</th>
                <th>Weight</th>
                <th>Scrap</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {datedRows.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-border hover:bg-secondary/50 cursor-pointer"
                  onClick={() => setSelectedKey(r.coilNo)}
                >
                  <td className="px-4 py-3 font-mono font-bold">{r.coilNo}</td>
                  <td>{r.gradeCode ?? '—'}</td>
                  <td className="font-mono">{r.weightMt != null ? Number(r.weightMt).toFixed(2) : '—'} MT</td>
                  <td className="font-mono">{r.scrapMt != null ? Number(r.scrapMt).toFixed(2) : '—'}</td>
                  <td className="text-muted-foreground">{r.timeTo ? formatPlantDateTime(r.timeTo) : '—'}</td>
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
                  key={hrsRowKey(c)}
                  className={`border-t border-border hover:bg-secondary/50 cursor-pointer ${selectedKey === hrsRowKey(c) ? 'bg-primary/10' : ''}`}
                  onClick={() => setSelectedKey(hrsRowKey(c))}
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
      title="HRS Live Dashboard"
      subtitle="HR slitting — live queue"
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
              tabs={[...HRS_LIVE_TABS]}
              activeId={tab}
              onChange={(id) => setTab(id as HrsLiveTab)}
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
                aria-label="Search HRS orders"
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
      <HrsOrderDetailDrawer
        card={drawerCard}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        mode={drawerMode}
        cachedDetail={drawerCard ? detailByCoil[drawerCard.coilNo] : null}
      />
    </MachineHeadShell>
  );
}
