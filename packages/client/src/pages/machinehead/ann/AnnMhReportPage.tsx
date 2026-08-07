import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Clock, Flame, TimerReset } from 'lucide-react';

import { ChartPanel } from '../../../components/analytics/ChartPanel';
import { DataUnavailable } from '../../../components/plant-head/DataUnavailable';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import type { AnnBoardRow } from '../../../components/process/bodies/AnnBaseCard';
import { CommandMetric } from '../../../components/command/CommandMetric';
import { ExportJobPanel } from '../../../components/export/ExportJobPanel';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { ZButton } from '../../../components/primitives/ZButton';
import { ZBadge } from '../../../components/primitives/ZBadge';
import { ZInput } from '../../../components/primitives/ZInput';
import { apiClient } from '../../../lib/apiClient';
import { reportingService } from '../../../lib/reportingService';
import type { AnnSpecLimit } from '../../../lib/annBatchingAdvisories';
import {
  METRICS,
  num,
  fmt,
  toDateTimeLocalValue,
  computeStats,
  statusFromSpec,
  isHeatingStageCode,
  isCoolingStageCode,
  buildStageWindows,
  readingsInWindows,
  type Stage,
  type Reading,
  type Stoppage,
  type MetricKey,
} from '../../../lib/annReportUtils';
import { DataFreshnessBadge } from '../../../components/DataFreshnessBadge';
import {
  AnnReportDetailRow,
  SearchableValueSelect,
  type AnnReportTableRow,
} from './AnnMhReportControls';

// PERF-A3 — recharts panels only after report is generated
const AnnMhReportCharts = lazy(() =>
  import('./AnnMhReportCharts').then((m) => ({ default: m.AnnMhReportCharts })),
);

// PERF-B3 — page is container; row/select live in AnnMhReportControls

type ChargeDetail = {
  charge: Record<string, unknown>;
  roster: Array<Record<string, unknown>>;
  stages: Stage[];
  readings: Reading[];
  stoppages: Stoppage[];
};

export function AnnMhReportPage() {
  const [bases, setBases] = useState<Array<{ base_no: string }>>([]);
  const [board, setBoard] = useState<AnnBoardRow[]>([]);
  const [specLimits, setSpecLimits] = useState<AnnSpecLimit[]>([]);

  const [baseNo, setBaseNo] = useState('');
  const [batchNo, setBatchNo] = useState('');

  const [from, setFrom] = useState(() => toDateTimeLocalValue(new Date(Date.now() - 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => toDateTimeLocalValue(new Date()));

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noReportMessage, setNoReportMessage] = useState<string | null>(null);
  const [report, setReport] = useState<ChargeDetail | null>(null);

  // Export job state (server-side XLSX generation).
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // --- Options (dependent) ---
  const batchOptions = useMemo(() => {
    if (!baseNo) return [];
    const set = new Set<string>();
    for (const row of board) {
      if (row.base_no !== baseNo) continue;
      const bn = row.charge?.annealing_batch_no;
      if (bn != null && bn !== '') set.add(String(bn));
    }
    return [...set].sort();
  }, [board, baseNo]);

  useEffect(() => {
    if (!batchNo) return;
    if (batchOptions.length === 0) {
      setBatchNo('');
      return;
    }
    if (!batchOptions.includes(batchNo)) setBatchNo('');
  }, [batchOptions, batchNo]);

  // --- Load masters once ---
  useEffect(() => {
    async function load() {
      const [b, bd, lim] = await Promise.all([
        apiClient.get<{ bases: Array<{ base_no: string }> }>('/stations/ann/bases'),
        apiClient.get<{ board: AnnBoardRow[] }>('/stations/ann/board'),
        apiClient.get<{ limits: AnnSpecLimit[] }>('/stations/ann/spec-limits').catch(() => ({ limits: [] as AnnSpecLimit[] })),
      ]);
      setBases(b.bases ?? []);
      setBoard(bd.board ?? []);
      setSpecLimits(lim.limits ?? []);
    }
    void load().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Load failed'));
  }, []);

  const resolveChargeNo = useCallback((): string | null => {
    if (!baseNo || !batchNo) return null;
    const match = board.find((r) => r.base_no === baseNo && String(r.charge?.annealing_batch_no ?? '') === batchNo);
    const cn = match?.charge?.charge_no;
    return cn ?? null;
  }, [board, baseNo, batchNo]);

  const generate = useCallback(async () => {
    setError(null);
    setNoReportMessage(null);
    setExportJobId(null);
    setExportError(null);
    setReport(null);
    if (!baseNo) {
      setNoReportMessage('No Base Selected');
      return;
    }
    if (!batchNo) {
      setNoReportMessage('No Batch Selected');
      return;
    }
    const chargeNo = resolveChargeNo();
    if (!chargeNo) {
      setNoReportMessage('No report available');
      return;
    }

    setLoading(true);
    try {
      const d = await apiClient.get<ChargeDetail>(`/stations/ann/charges/${encodeURIComponent(chargeNo)}`);
      setReport(d);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  }, [baseNo, batchNo, resolveChargeNo]);

  const reset = useCallback(() => {
    setBaseNo('');
    setBatchNo('');
    setReport(null);
    setError(null);
    setNoReportMessage(null);
    setExportJobId(null);
    setExportError(null);
    setFrom(toDateTimeLocalValue(new Date(Date.now() - 24 * 60 * 60 * 1000)));
    setTo(toDateTimeLocalValue(new Date()));
  }, []);

  const reportComputed = useMemo(() => {
    if (!report) return null;
    const charge = report.charge ?? {};

    const stagesSorted = [...(report.stages ?? [])].sort((a, b) => a.seq - b.seq);

    const fromMs = from ? new Date(from).getTime() : -Infinity;
    const toMs = to ? new Date(to).getTime() : Infinity;

    const readingsAsc = [...(report.readings ?? [])].sort((a, b) => a.taken_at.localeCompare(b.taken_at));
    const readingsInWindow = readingsAsc.filter((r) => {
      const ms = new Date(r.taken_at).getTime();
      return ms >= fromMs && ms <= toMs;
    });

    // Map ANN spec limits by metric key (param_key should align with reading fields).
    const limitByMetric = new Map<MetricKey, { min: number | null; max: number | null }>();
    for (const m of METRICS) {
      const row = specLimits.find((l) => l.param_key === m.key);
      limitByMetric.set(m.key, {
        min: row?.min_val != null ? Number(row.min_val) : null,
        max: row?.max_val != null ? Number(row.max_val) : null,
      });
    }

    const metricsStats: Record<MetricKey, { min: number | null; max: number | null; avg: number | null; current: number | null }> =
      METRICS.reduce((acc, m) => {
        const values = readingsInWindow.map((r) => num(r[m.key]));
        acc[m.key] = computeStats(values);
        return acc;
      }, {} as Record<MetricKey, { min: number | null; max: number | null; avg: number | null; current: number | null }>);

    const latest = readingsAsc[readingsAsc.length - 1] ?? null;
    const openStoppage = (report.stoppages ?? []).find((s) => !s.end_at);
    const statusLabel =
      String(charge.status ?? 'DONE') === 'DONE' ? 'COMPLETE' : openStoppage ? 'STOPPAGE' : String(charge.status ?? 'IN_PROCESS');

    const completionPct = (() => {
      const total = stagesSorted.length || 1;
      const done = stagesSorted.filter((s) => (s.end_at != null) || s.skipped).length;
      return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
    })();

    const stageTimeline = stagesSorted
      .filter((s) => s.start_at)
      .map((s) => {
        const startMs = new Date(String(s.start_at)).getTime();
        const endMs = s.end_at ? new Date(String(s.end_at)).getTime() : Date.now();
        return {
          key: s.stage_code,
          stage: s,
          startMs,
          endMs,
          durationMin: Math.max(0, (endMs - startMs) / 60000),
        };
      })
      .sort((a, b) => a.startMs - b.startMs);

    const cycleStartMs = stageTimeline[0]?.startMs ?? null;
    const cycleEndMs = stageTimeline.length ? Math.max(...stageTimeline.map((t) => t.endMs)) : null;
    const cycleDurationMin =
      cycleStartMs != null && cycleEndMs != null ? Math.max(0, (cycleEndMs - cycleStartMs) / 60000) : null;

    const activeMin = (() => {
      const fromCharge = num(charge.total_active_min as number | string | null | undefined);
      if (fromCharge != null) return fromCharge;
      return stageTimeline.reduce((s, t) => s + t.durationMin, 0);
    })();

    const idleMin = (() => {
      const fromCharge = num(charge.total_idle_min as number | string | null | undefined);
      if (fromCharge != null) return fromCharge;
      let idle = 0;
      for (let i = 1; i < stageTimeline.length; i++) {
        const prev = stageTimeline[i - 1];
        const cur = stageTimeline[i];
        if (prev.endMs && cur.startMs && cur.startMs > prev.endMs) idle += (cur.startMs - prev.endMs) / 60000;
      }
      return idle;
    })();

    const stoppageTimeline = (report.stoppages ?? [])
      .filter((s) => s.start_at)
      .map((s) => {
        const startMs = new Date(String(s.start_at)).getTime();
        const endMs = s.end_at ? new Date(String(s.end_at)).getTime() : Date.now();
        const durMin = Math.max(0, (endMs - startMs) / 60000);
        return { key: String(s.stoppage_id), stoppage: s, startMs, endMs, durationMin: durMin };
      })
      .filter((s) => cycleStartMs != null && s.endMs >= cycleStartMs)
      .sort((a, b) => a.startMs - b.startMs);

    const peakTemp = metricsStats.charge_temp.max;
    const avgTemp = metricsStats.charge_temp.avg;

    const currentPress = metricsStats.base_press.current;
    const currentFlow = metricsStats.n2h2_flow.current;

    const statusTone: Tone =
      statusLabel === 'COMPLETE' ? 'info'
        : statusLabel === 'STOPPAGE' ? 'warning'
          : statusLabel === 'PENDING' ? 'accent'
            : 'success';

    // Table rows: Timestamp x Metric
    const tableRows = readingsInWindow.flatMap((r) => {
      const taken = r.taken_at;
      return METRICS.map((m) => {
        const current = num(r[m.key]);
        const limit = limitByMetric.get(m.key);
        const spec = statusFromSpec(current, limit);
        return {
          rowId: `${r.reading_id}:${m.key}`,
          taken_at: taken,
          takenMs: new Date(taken).getTime(),
          parameter: m.label,
          metricKey: m.key,
          current,
          min: metricsStats[m.key].min,
          max: metricsStats[m.key].max,
          avg: metricsStats[m.key].avg,
          status: spec.status,
          statusTone: spec.tone,
          remarks: spec.remarks,
        };
      });
    });

    return {
      charge,
      stagesSorted,
      readingsAsc,
      readingsInWindow,
      roster: report.roster,
      stoppages: report.stoppages,
      limitByMetric,
      metricsStats,
      latest,
      statusLabel,
      statusTone,
      completionPct,
      stageTimeline,
      cycleStartMs,
      cycleEndMs,
      cycleDurationMin,
      activeMin,
      idleMin,
      stoppageTimeline,
      peakTemp,
      avgTemp,
      currentPress,
      currentFlow,
      tableRows,
    };
  }, [report, from, to, specLimits]);

  const handleExport = useCallback(async () => {
    setExportError(null);
    setExportJobId(null);
    if (!reportComputed) return;
    const chargeNo = String(reportComputed.charge.charge_no ?? '');
    if (!chargeNo) {
      setExportError('Charge number is missing for export.');
      return;
    }
    const base = baseNo || String(reportComputed.charge.base_no ?? '');
    const batch = batchNo || String(reportComputed.charge.annealing_batch_no ?? '');

    setExporting(true);
    try {
      const job = await reportingService.createExportJob({
        type: 'ANN_CHARGE_REPORT',
        format: 'XLSX',
        scope: {
          chargeNo,
          baseNo: base,
          annealingBatchNo: batch,
          dateFrom: from,
          dateTo: to,
        },
      });
      setExportJobId(job.jobId);
    } catch (e: unknown) {
      setExportError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }, [reportComputed, baseNo, batchNo, from, to]);

  // --- Table state ---
  const [sortKey, setSortKey] = useState<'takenMs' | 'parameter' | 'current' | 'min' | 'max' | 'avg' | 'status'>('takenMs');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 30;

  function toggleSort(nextKey: typeof sortKey) {
    setSortKey(nextKey);
    setSortDir((d) => (sortKey === nextKey ? (d === 'asc' ? 'desc' : 'asc') : 'asc'));
    setPage(1);
  }

  useEffect(() => {
    // Reset paging/sorting whenever a new report is generated.
    setPage(1);
    setSortKey('takenMs');
    setSortDir('desc');
    setSearch('');
  }, [reportComputed?.tableRows?.length]);

  const filteredSortedRows = useMemo(() => {
    if (!reportComputed) return [];
    const q = search.trim().toLowerCase();
    let rows = reportComputed.tableRows;
    if (q) {
      rows = rows.filter((r) => r.parameter.toLowerCase().includes(q) || r.remarks.toLowerCase().includes(q) || r.status.toLowerCase().includes(q));
    }
    const dir = sortDir === 'asc' ? 1 : -1;
    const safeString = (v: unknown) => (v == null ? '' : String(v));
    rows = [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (sortKey === 'parameter' || sortKey === 'status') return dir * safeString(av).localeCompare(safeString(bv));
      const an = typeof av === 'number' ? av : av == null ? NaN : Number(av);
      const bn = typeof bv === 'number' ? bv : bv == null ? NaN : Number(bv);
      const aOk = Number.isFinite(an);
      const bOk = Number.isFinite(bn);
      if (!aOk && !bOk) return 0;
      if (!aOk) return 1;
      if (!bOk) return -1;
      return dir * (an - bn);
    });
    return rows;
  }, [reportComputed, search, sortKey, sortDir]);

  const pageCount = reportComputed ? Math.max(1, Math.ceil(filteredSortedRows.length / pageSize)) : 1;
  const pageRows = reportComputed ? filteredSortedRows.slice((page - 1) * pageSize, page * pageSize) : [];

  // --- Chart series builders ---
  // (recharts series live in AnnMhReportCharts — PERF-A3)

  const heatingWindows = useMemo(() => {
    if (!reportComputed) return [];
    return buildStageWindows(reportComputed.stagesSorted, isHeatingStageCode);
  }, [reportComputed]);

  const coolingWindows = useMemo(() => {
    if (!reportComputed) return [];
    return buildStageWindows(reportComputed.stagesSorted, isCoolingStageCode);
  }, [reportComputed]);

  const heatingReadings = useMemo(() => readingsInWindows(reportComputed?.readingsAsc ?? [], heatingWindows), [heatingWindows, reportComputed]);
  const coolingReadings = useMemo(() => readingsInWindows(reportComputed?.readingsAsc ?? [], coolingWindows), [coolingWindows, reportComputed]);

  return (
    <MachineHeadShell
      title="REPORT"
      subtitle="Generate detailed production reports"
      fillViewport
      headerActions={<DataFreshnessBadge />}
      onRefresh={undefined}
    >
      <div className="space-y-4 min-h-0 flex-1 overflow-hidden flex flex-col">
        {/* Filters */}
        <section className="rounded-lg border border-border bg-background p-4 shadow-sm">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[220px]">
              <SearchableValueSelect
                label="Base Number"
                value={baseNo}
                onChange={(v) => setBaseNo(v)}
                options={[...new Set(bases.map((b) => String(b.base_no)))]}
                placeholder="Select base…"
              />
            </div>

            <div className="min-w-[260px]">
              <SearchableValueSelect
                label="Annealing Batch Number"
                value={batchNo}
                onChange={(v) => setBatchNo(v)}
                options={batchOptions}
                placeholder={baseNo ? 'Select batch…' : 'Select base first…'}
                disabled={!baseNo}
              />
            </div>

            <div className="flex flex-wrap gap-4 items-end">
              <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                From
                <input
                  type="datetime-local"
                  className="h-10 min-h-10 rounded-lg border border-input bg-background px-3 text-sm font-mono"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                To
                <input
                  type="datetime-local"
                  className="h-10 min-h-10 rounded-lg border border-input bg-background px-3 text-sm font-mono"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </label>
            </div>

            <div className="flex gap-2 ml-auto">
              <ZButton
                type="button"
                variant="primary"
                className="h-10 min-h-10 rounded-lg"
                disabled={loading || !baseNo || !batchNo}
                onClick={() => void generate()}
              >
                <Flame className="h-4 w-4" aria-hidden /> Generate Report
              </ZButton>
              <ZButton
                type="button"
                variant="secondary"
                className="h-10 min-h-10 rounded-lg"
                disabled={loading}
                onClick={reset}
              >
                <TimerReset className="h-4 w-4" aria-hidden /> Reset
              </ZButton>
            </div>
          </div>

          {error && (
            <div className="mt-3 text-sm text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" aria-hidden /> {error}
              <ZButton type="button" variant="secondary" size="sm" className="ml-2" disabled={loading} onClick={() => void generate()}>
                Retry
              </ZButton>
            </div>
          )}
        </section>

        {/* Empty / Loading */}
        {!reportComputed && !loading && !error && (
          <DataUnavailable message={noReportMessage ?? 'Generate a report to view production analytics.'} />
        )}
        {loading && (
          <div className="rounded-lg border border-border bg-background p-6 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="h-3.5 w-3.5 rounded-full bg-muted animate-pulse" />
              <p className="text-sm text-muted-foreground">Loading production report…</p>
            </div>
          </div>
        )}

        {reportComputed && (
          <div className="min-h-0 flex-1 overflow-auto space-y-4 pb-6">
            {/* Production summary + KPI cards */}
            <section className="grid gap-3 md:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Production Summary</h2>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Batch</p>
                    <p className="mt-1 font-semibold font-mono tabular-nums text-foreground truncate">
                      {String(reportComputed.charge.annealing_batch_no ?? batchNo ?? '—')}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Base</p>
                    <p className="mt-1 font-semibold font-mono tabular-nums text-foreground truncate">
                      {baseNo || String(reportComputed.charge.base_no ?? '—')}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Charge</p>
                    <p className="mt-1 font-semibold font-mono tabular-nums text-foreground truncate">
                      {String(reportComputed.charge.charge_no ?? '—')}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Grade</p>
                    <p className="mt-1 font-semibold text-foreground">{String(reportComputed.charge.grade_code ?? '—')}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Coils</p>
                    <p className="mt-1 font-semibold font-mono tabular-nums text-foreground">
                      {String(reportComputed.charge.no_of_coils ?? '—')}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Weight (MT)</p>
                    <p className="mt-1 font-semibold font-mono tabular-nums text-foreground">
                      {num(reportComputed.charge.charge_wt_mt as number | string | null | undefined) != null
                        ? `${num(reportComputed.charge.charge_wt_mt as number | string | null | undefined)!.toFixed(2)}`
                        : '—'}
                    </p>
                  </div>
                  <div className="min-w-0 col-span-2">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Start / End</p>
                    <p className="mt-1 font-semibold font-mono tabular-nums text-foreground">
                      {reportComputed.stageTimeline[0]
                        ? `${new Date(String(reportComputed.stageTimeline[0].stage.start_at)).toLocaleString('en-IN', {
                          month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true,
                        })}`
                        : '—'}
                      {' → '}
                      {reportComputed.cycleEndMs ? new Date(reportComputed.cycleEndMs).toLocaleString('en-IN', {
                        month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: true,
                      }) : '—'}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Current Status</p>
                    <p className="mt-1 font-semibold font-mono tabular-nums text-foreground">
                      {reportComputed.statusLabel}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background p-4 shadow-sm">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Cycle KPI</h2>
                <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                  <CommandMetric
                    label="Cycle Time"
                    value={reportComputed.cycleDurationMin != null ? `${reportComputed.cycleDurationMin.toFixed(1)} min` : '—'}
                    tone={reportComputed.cycleDurationMin != null ? 'info' : 'muted'}
                  />
                  <CommandMetric
                    label="Completion"
                    value={`${reportComputed.completionPct}%`}
                    tone={reportComputed.completionPct >= 100 ? 'success' : reportComputed.statusTone}
                    sub={reportComputed.statusLabel}
                  />
                  <CommandMetric
                    label="Peak Temp"
                    value={reportComputed.peakTemp != null ? `${reportComputed.peakTemp.toFixed(1)} °C` : '—'}
                    tone={reportComputed.peakTemp != null ? 'purple' : 'muted'}
                  />
                  <CommandMetric
                    label="Avg Temp"
                    value={reportComputed.avgTemp != null ? `${reportComputed.avgTemp.toFixed(1)} °C` : '—'}
                    tone={reportComputed.avgTemp != null ? 'info' : 'muted'}
                  />
                  <CommandMetric
                    label="Pressure"
                    value={reportComputed.currentPress != null ? `${reportComputed.currentPress.toFixed(2)}` : '—'}
                    tone={reportComputed.currentPress != null ? 'warning' : 'muted'}
                    sub="latest"
                  />
                  <CommandMetric
                    label="Flow"
                    value={reportComputed.currentFlow != null ? `${reportComputed.currentFlow.toFixed(2)}` : '—'}
                    tone={reportComputed.currentFlow != null ? 'accent' : 'muted'}
                    sub="N2/H2"
                  />
                </div>
              </div>
            </section>

            {/* Charge + roster (read-only; stages/stoppages/readings live in charts & table below) */}
            <section className="rounded-lg border border-border bg-background p-4 shadow-sm">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Charge & Roster</h2>
              {(() => {
                const charge = reportComputed.charge ?? {};

                return (
                  <div className="grid min-h-0 flex-1 gap-3 overflow-hidden lg:grid-cols-2 mt-4">
                    <section className="space-y-3 rounded-lg border border-border bg-background p-4 shadow-sm">
                      <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Charge details</h2>
                      <dl className="grid grid-cols-2 gap-3 text-xs">
                        {(
                          [
                            ['F/C No', charge.furnace_id != null ? String(charge.furnace_id) : '—'],
                            ['Exp unload', fmt(charge.exp_unloading_time as string | null | undefined)],
                            [
                              'Unload wt',
                              charge.unloading_wt_mt != null
                                ? `${Number(charge.unloading_wt_mt).toFixed(2)} MT`
                                : '—',
                            ],
                            ['Dew N₂', charge.dew_point_n2 != null ? String(charge.dew_point_n2) : '—'],
                            ['Dew H₂', charge.dew_point_h2 != null ? String(charge.dew_point_h2) : '—'],
                          ] as Array<[string, string]>
                        ).map(([label, value]) => (
                          <div key={label} className="min-w-0">
                            <dt className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
                            <dd className="mt-0.5 font-semibold font-mono tabular-nums text-foreground truncate">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </section>

                    <section className="rounded-lg border border-border bg-background p-4 space-y-2 shadow-sm">
                      <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Roster</h2>
                      {(reportComputed.roster ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground">—</p>
                      ) : (
                        (reportComputed.roster ?? []).map((r: Record<string, unknown>) => {
                          const coilNo = String(r.coil_no ?? '');
                          const gradeCode = r.grade_code != null ? String(r.grade_code) : '';
                          const weight = r.weight_mt != null ? Number(r.weight_mt) : null;
                          const disposition = r.disposition != null ? String(r.disposition) : 'ADVANCE';
                          return (
                            <div
                              key={coilNo}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs"
                            >
                              <span className="font-mono tabular-nums text-foreground">
                                {coilNo}
                                {gradeCode ? ` · ${gradeCode}` : ''}
                                {' · '}
                                {weight != null ? `${weight.toFixed(2)} MT` : '—'}
                              </span>
                              {disposition === 'HOLD' ? (
                                <ZBadge tone="accent" label="HOLD" />
                              ) : disposition === 'REJECT' ? (
                                <ZBadge tone="destructive" label="REJECT" />
                              ) : (
                                <ZBadge tone="success" label={disposition || 'ADVANCE'} />
                              )}
                            </div>
                          );
                        })
                      )}
                    </section>
                  </div>
                );
              })()}
            </section>

            {/* Charts */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Charts</h2>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Suspense fallback={<div className="col-span-full h-64 animate-pulse rounded-lg bg-muted/40" aria-busy />}>
                  <AnnMhReportCharts
                    readingsInWindow={reportComputed.readingsInWindow}
                    chargeTempAvg={reportComputed.metricsStats.charge_temp.avg}
                    heatingReadings={heatingReadings}
                    coolingReadings={coolingReadings}
                  />
                </Suspense>

                {/* Cycle Timeline */}
                <ChartPanel title="Cycle Timeline">
                  <div className="space-y-3">
                    {reportComputed.stageTimeline.length === 0 ? (
                      <DataUnavailable message="No stage timing found." />
                    ) : (
                      <>
                        <div className="relative rounded-lg border border-border bg-background p-3">
                          <div className="flex h-3.5 w-full overflow-hidden rounded bg-muted">
                            {(() => {
                              const startMs = reportComputed.cycleStartMs ?? reportComputed.stageTimeline[0].startMs;
                              const endMs = reportComputed.cycleEndMs ?? reportComputed.stageTimeline[reportComputed.stageTimeline.length - 1].endMs;
                              const total = Math.max(1, endMs - startMs);
                              return reportComputed.stageTimeline.map((seg) => {
                                const w = ((seg.endMs - seg.startMs) / total) * 100;
                                return (
                                  <div
                                    key={`${seg.stage.seq}:${seg.key}`}
                                    title={`${seg.stage.stage_code} (${seg.durationMin.toFixed(1)} min)`}
                                    className={`h-full ${seg.stage.skipped ? 'bg-muted/60' : 'bg-success/30'}`}
                                    style={{ width: `${w}%` }}
                                  />
                                );
                              });
                            })()}
                          </div>
                          <div className="mt-2 flex justify-between text-[10px] text-muted-foreground font-mono">
                            <span>{reportComputed.cycleStartMs ? new Date(reportComputed.cycleStartMs).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                            <span>{reportComputed.cycleEndMs ? new Date(reportComputed.cycleEndMs).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                          </div>
                        </div>
                        <div className="grid gap-2">
                          {reportComputed.stagesSorted.map((s) => {
                            const start = s.start_at ? new Date(String(s.start_at)).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
                            const end = s.end_at ? new Date(String(s.end_at)).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }) : '—';
                            return (
                              <div key={`${s.seq}:${s.stage_code}`} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-xs">
                                <span className="font-semibold">{s.stage_code}</span>
                                <span className="font-mono tabular-nums text-muted-foreground">{start} → {end}{s.skipped ? ' · SKIP' : ''}</span>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </ChartPanel>

                {/* Status Timeline */}
                <ChartPanel title="Status Timeline">
                  {reportComputed.stoppageTimeline.length === 0 ? (
                    <DataUnavailable message="No stoppages recorded." />
                  ) : (
                    <div className="space-y-3">
                      <div className="relative rounded-lg border border-border bg-background p-3">
                        {(() => {
                          const startMs = reportComputed.cycleStartMs ?? reportComputed.stoppageTimeline[0].startMs;
                          const endMs = reportComputed.cycleEndMs ?? reportComputed.stoppageTimeline[reportComputed.stoppageTimeline.length - 1].endMs;
                          const total = Math.max(1, endMs - startMs);
                          const baseBar = (
                            <div className="flex h-3.5 w-full overflow-hidden rounded bg-muted/40" aria-hidden>
                              <div className="h-full w-full bg-muted/20" />
                            </div>
                          );
                          return (
                            <div className="space-y-2">
                              {baseBar}
                              <div className="absolute inset-x-3 flex h-3.5 overflow-hidden rounded pointer-events-none">
                                <div className="relative w-full">
                                  {reportComputed.stoppageTimeline.map((seg) => {
                                    const w = ((seg.endMs - seg.startMs) / total) * 100;
                                    const left = ((seg.startMs - startMs) / total) * 100;
                                    return (
                                      <div
                                        key={seg.key}
                                        title={`${seg.stoppage.category_code} (${seg.durationMin.toFixed(1)} min)`}
                                        className="absolute h-full bg-warning/40"
                                        style={{ left: `${left}%`, width: `${w}%` }}
                                      />
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground font-mono">
                          <span>{reportComputed.cycleStartMs ? new Date(reportComputed.cycleStartMs).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                          <span>{reportComputed.cycleEndMs ? new Date(reportComputed.cycleEndMs).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                        </div>
                      </div>
                      <div className="grid gap-2">
                        {reportComputed.stoppageTimeline.map((s) => (
                          <div key={s.key} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2 text-xs">
                            <span className="font-semibold">{s.stoppage.category_code}</span>
                            <span className="font-mono tabular-nums text-muted-foreground">
                              {new Date(s.stoppage.start_at).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })} →{' '}
                              {s.stoppage.end_at
                                ? new Date(String(s.stoppage.end_at)).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
                                : 'OPEN'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </ChartPanel>

                {/* Process Duration */}
                <ChartPanel title="Process Duration">
                  <div className="space-y-3">
                    <div className="rounded-lg border border-border bg-card p-4">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Active vs Idle</span>
                        <span className="font-mono tabular-nums text-foreground text-sm">
                          {reportComputed.activeMin.toFixed(1)} / {reportComputed.idleMin.toFixed(1)} min
                        </span>
                      </div>
                      <div className="mt-3 h-3.5 w-full overflow-hidden rounded-full bg-muted/40">
                        <div
                          className="h-full rounded-full bg-success/30"
                          style={{ width: `${(reportComputed.activeMin / Math.max(1, reportComputed.activeMin + reportComputed.idleMin)) * 100}%` }}
                        />
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                        <span>Active</span>
                        <span>Idle</span>
                      </div>
                    </div>
                  </div>
                </ChartPanel>
              </div>
            </section>

            {/* Detailed Table */}
            <section className="space-y-3">
              <div className="flex items-end justify-between gap-4">
                <h2 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Detailed Table</h2>
                <div className="flex flex-wrap gap-3 items-end">
                  <div className="min-w-[260px]">
                    <ZInput
                      label="Search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Parameter / Remarks / Status"
                      mono={false}
                      className="!h-10 rounded-lg"
                    />
                  </div>
                </div>
              </div>

              <div className="overflow-auto rounded-lg border border-border bg-background">
                <div className="min-w-[960px]">
                  <table className="w-full text-xs text-left">
                    <thead className="sticky top-0 bg-card text-[10px] uppercase tracking-[0.14em] text-muted-foreground border-b border-border">
                      <tr>
                        <th className="p-2 font-medium" scope="col">
                          <button type="button" className="inline-flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => toggleSort('takenMs')} aria-label="Sort by timestamp">
                            Timestamp{sortKey === 'takenMs' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : null}
                          </button>
                        </th>
                        <th className="p-2 font-medium" scope="col">
                          <button type="button" className="inline-flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => toggleSort('parameter')} aria-label="Sort by parameter">
                            Parameter{sortKey === 'parameter' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : null}
                          </button>
                        </th>
                        <th className="p-2 font-medium" scope="col">
                          <button type="button" className="inline-flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => toggleSort('current')} aria-label="Sort by current value">
                            Current Value{sortKey === 'current' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : null}
                          </button>
                        </th>
                        <th className="p-2 font-medium" scope="col">
                          <button type="button" className="inline-flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => toggleSort('min')} aria-label="Sort by minimum">
                            Minimum{sortKey === 'min' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : null}
                          </button>
                        </th>
                        <th className="p-2 font-medium" scope="col">
                          <button type="button" className="inline-flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => toggleSort('max')} aria-label="Sort by maximum">
                            Maximum{sortKey === 'max' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : null}
                          </button>
                        </th>
                        <th className="p-2 font-medium" scope="col">
                          <button type="button" className="inline-flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => toggleSort('avg')} aria-label="Sort by average">
                            Average{sortKey === 'avg' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : null}
                          </button>
                        </th>
                        <th className="p-2 font-medium" scope="col">
                          <button type="button" className="inline-flex items-center gap-1 cursor-pointer hover:text-foreground" onClick={() => toggleSort('status')} aria-label="Sort by status">
                            Status{sortKey === 'status' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : null}
                          </button>
                        </th>
                        <th className="p-2 font-medium" scope="col">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="p-6 text-center text-muted-foreground">No rows found.</td>
                        </tr>
                      ) : (
                        pageRows.map((r) => (
                          <AnnReportDetailRow key={r.rowId} r={r as AnnReportTableRow} />
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  Page {page} of {pageCount} · {filteredSortedRows.length} rows
                </div>
                <div className="flex gap-2">
                  <ZButton type="button" variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Prev
                  </ZButton>
                  <ZButton type="button" variant="secondary" size="sm" disabled={page >= pageCount} onClick={() => setPage((p) => Math.min(pageCount, p + 1))}>
                    Next
                  </ZButton>
                </div>
              </div>
            </section>

            {/* Export Section (button wired later in client-export-trigger) */}
            <section className="space-y-3">
              <ChartPanel title="Export">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <h3 className="text-sm font-semibold">Export to Excel (.xlsx)</h3>
                    <p className="text-xs text-muted-foreground">Exports the same report dataset to a professionally formatted XLSX.</p>
                  </div>
                  {!exportJobId ? (
                    <ZButton
                      type="button"
                      variant="primary"
                      disabled={exporting || loading || !reportComputed}
                      onClick={() => void handleExport()}
                    >
                      <Clock className="h-4 w-4" aria-hidden /> {exporting ? 'Exporting…' : 'Export'}
                    </ZButton>
                  ) : null}
                </div>

                {exportError && <StatusBadge tone="destructive" label={exportError} />}

                {exportJobId && (
                  <ExportJobPanel
                    jobId={exportJobId}
                    onReset={() => {
                      setExportJobId(null);
                      setExportError(null);
                    }}
                  />
                )}
              </ChartPanel>
            </section>
          </div>
        )}
      </div>
    </MachineHeadShell>
  );
}

