import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { ZBadge } from '../../../components/primitives/ZBadge';
import { ZButton } from '../../../components/primitives/ZButton';
import { ZInput } from '../../../components/primitives/ZInput';
import { apiClient } from '../../../lib/apiClient';
import type { ProcessQueueCard } from '../../../store/processStore';
import type { Tone } from '../../../lib/tones';

// PERF-A3 — recharts only when tank-temp chart mounts
const PklMhTankTempsChart = lazy(() =>
  import('./PklMhLiveCharts').then((m) => ({ default: m.PklMhTankTempsChart })),
);

type ChartRow = {
  chart_time: string;
  tank_no: number | null;
  tank_level: number | string | null;
  tank_temp_degc: number | string | null;
  acid_strength_pct: number | string | null;
  iron_strength_pct: number | string | null;
};

function n(v: unknown) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function s(v: unknown) {
  return v == null || v === '' ? '—' : String(v);
}

function queueTone(status: string): Tone {
  const u = status.toUpperCase();
  if (u === 'PENDING' || u === 'HOLD') return 'accent';
  if (u === 'IN_PROGRESS') return 'success';
  if (u === 'STOPPAGE') return 'warning';
  if (u === 'PREPARING') return 'info';
  if (u === 'REJECTED') return 'destructive';
  return 'muted';
}

function QueueCard({
  card,
  onOpen,
}: {
  card: ProcessQueueCard;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className="rounded-lg border border-border bg-card px-4 py-3 text-left shadow-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[5.5rem]"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono font-bold tabular-nums text-foreground">{card.coilNo}</p>
        <ZBadge tone={queueTone(card.status)} label={card.status} />
      </div>
      <p className="mt-1 text-xs font-mono tabular-nums text-muted-foreground">
        {card.gradeCode ?? '—'} · {Number(card.weightMt ?? 0).toFixed(2)} MT
        {card.widthMm != null ? ` · ${card.widthMm}×${card.thicknessMm ?? '—'} mm` : ''}
      </p>
    </button>
  );
}

/** PKL MH Live — order card + T1–T3 tanks + trends (revamp MH-1). */
export function ProcessLineLiveDashboard({ line }: { line: 'HRS' | 'PKL' }) {
  const navigate = useNavigate();
  const [queue, setQueue] = useState<ProcessQueueCard[]>([]);
  const [filter, setFilter] = useState('');
  const [chartRows, setChartRows] = useState<ChartRow[]>([]);
  const [drillTank, setDrillTank] = useState<1 | 2 | 3 | null>(null);
  const code = line.toLowerCase();

  const reload = useCallback(async () => {
    const path = line === 'PKL' ? '/pkl-order/queue' : line === 'HRS' ? '/hrs-order/queue' : `/stations/${code}/queue`;
    const q = await apiClient.get<{ queue: ProcessQueueCard[] }>(path);
    setQueue(q.queue ?? []);
    if (line === 'PKL') {
      try {
        const active = await apiClient.get<{ shiftLogId?: string }>('/shift-logs/active/PKL');
        const id = active.shiftLogId ?? null;
        if (id) {
          const ch = await apiClient.get<{ rows: ChartRow[] }>(`/stations/pkl/chart/${encodeURIComponent(id)}`);
          setChartRows(ch.rows ?? []);
        } else {
          setChartRows([]);
        }
      } catch {
        setChartRows([]);
      }
    }
  }, [code, line]);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 30_000);
    return () => clearInterval(id);
  }, [reload]);

  const running = useMemo(
    () => queue.find((c) => c.status === 'IN_PROGRESS') ?? null,
    [queue],
  );

  const latestByTank = useMemo(() => {
    const map: Record<number, ChartRow | undefined> = {};
    for (const r of chartRows) {
      const tn = Number(r.tank_no);
      if (tn < 1 || tn > 3) continue;
      if (!map[tn] || String(r.chart_time) >= String(map[tn]!.chart_time)) map[tn] = r;
    }
    return map;
  }, [chartRows]);

  const trendData = useMemo(() => {
    const byTime = new Map<string, Record<string, number | string>>();
    for (const r of chartRows) {
      const t = String(r.chart_time);
      if (!byTime.has(t)) byTime.set(t, { time: t });
      const row = byTime.get(t)!;
      const tn = Number(r.tank_no);
      const temp = n(r.tank_temp_degc);
      if (tn >= 1 && tn <= 3 && temp != null) row[`t${tn}Temp`] = temp;
    }
    return [...byTime.values()].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  }, [chartRows]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return queue;
    return queue.filter((c) => {
      const hay = [c.coilNo, c.motherCoilNo, c.slitId, c.gradeCode, c.batchNumber].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [filter, queue]);

  if (line === 'HRS') {
    return (
      <MachineHeadShell title="HRS Live Dashboard" subtitle="Coil runs" fillViewport onRefresh={() => void reload()}>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-1">
          <div className="w-full max-w-sm">
            <ZInput
              className="!h-10 rounded-lg"
              placeholder="Filter coil / mother / slit / grade"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              mono={false}
              aria-label="Filter HRS queue"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto grid grid-cols-1 gap-2 lg:grid-cols-2">
            {filtered.map((c) => (
              <QueueCard
                key={c.coilNo}
                card={c}
                onOpen={() => navigate(`/machine-head/hrs/coil/${encodeURIComponent(c.coilNo)}`)}
              />
            ))}
          </div>
        </div>
      </MachineHeadShell>
    );
  }

  return (
    <MachineHeadShell title="PKL Live Dashboard" subtitle="Order · tanks · trends" fillViewport onRefresh={() => void reload()}>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-1">
        {running ? (
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground mb-2">Order Status</p>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xl font-bold tabular-nums text-foreground">{running.coilNo}</p>
                <p className="text-sm text-muted-foreground">{running.customerName} · {running.gradeCode}</p>
                <p className="text-xs font-mono tabular-nums mt-1">
                  {running.widthMm}×{running.thicknessMm} mm · {running.weightMt} MT
                </p>
              </div>
              <ZBadge tone="success" label={running.status} dot />
            </div>
            <ZButton
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => navigate(`/machine-head/pkl/coil/${encodeURIComponent(running.coilNo)}`)}
            >
              Open coil detail
            </ZButton>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">No coil in progress</div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([1, 2, 3] as const).map((tn) => {
            const r = latestByTank[tn];
            return (
              <button
                key={tn}
                type="button"
                onClick={() => setDrillTank(tn)}
                className="rounded-lg border border-border bg-card p-4 text-left shadow-sm hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[5.5rem]"
              >
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Tank T{tn}</p>
                {r ? (
                  <dl className="mt-2 grid grid-cols-2 gap-1 text-xs font-mono tabular-nums">
                    <dt className="text-muted-foreground uppercase tracking-wide">Level</dt><dd>{s(r.tank_level)}</dd>
                    <dt className="text-muted-foreground uppercase tracking-wide">Temp</dt><dd>{s(r.tank_temp_degc)}</dd>
                    <dt className="text-muted-foreground uppercase tracking-wide">Acid%</dt><dd>{s(r.acid_strength_pct)}</dd>
                    <dt className="text-muted-foreground uppercase tracking-wide">Iron%</dt><dd>{s(r.iron_strength_pct)}</dd>
                  </dl>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No reading</p>
                )}
              </button>
            );
          })}
        </div>

        {trendData.length > 0 && (
          <Suspense fallback={<div className="rounded-lg border border-border bg-card p-4 h-64 shadow-sm animate-pulse" aria-busy />}>
            <PklMhTankTempsChart data={trendData} />
          </Suspense>
        )}

        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground mb-2">Queue</p>
          <div className="mb-2 w-full max-w-sm">
            <ZInput
              className="!h-10 rounded-lg"
              placeholder="Filter…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              mono={false}
              aria-label="Filter PKL queue"
            />
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {filtered.map((c) => (
              <QueueCard
                key={c.coilNo}
                card={c}
                onOpen={() => navigate(`/machine-head/pkl/coil/${encodeURIComponent(c.coilNo)}`)}
              />
            ))}
          </div>
        </div>
      </div>

      {drillTank != null && (
        <div className="fixed inset-0 z-50 bg-primary/40 flex items-center justify-center p-4">
          <div className="bg-background rounded-lg border border-border p-6 w-full max-w-md space-y-3 max-h-[80vh] overflow-y-auto shadow-2xl">
            <h3 className="font-bold text-foreground">Tank T{drillTank} readings</h3>
            {chartRows.filter((r) => Number(r.tank_no) === drillTank).map((r) => (
              <div key={`${r.chart_time}-${r.tank_no}`} className="border border-border rounded-lg p-3 text-sm font-mono bg-card">
                <p className="font-bold mb-1">{r.chart_time}</p>
                <p>Level {s(r.tank_level)} · Temp {s(r.tank_temp_degc)} · Acid {s(r.acid_strength_pct)} · Iron {s(r.iron_strength_pct)}</p>
              </div>
            ))}
            {chartRows.filter((r) => Number(r.tank_no) === drillTank).length === 0 && (
              <p className="text-muted-foreground text-sm">No readings</p>
            )}
            <ZButton type="button" variant="secondary" onClick={() => setDrillTank(null)}>Close</ZButton>
          </div>
        </div>
      )}
    </MachineHeadShell>
  );
}

/** @deprecated use ProcessLineLiveDashboard */
export function PklMhLiveDashboard() {
  return <ProcessLineLiveDashboard line="PKL" />;
}
