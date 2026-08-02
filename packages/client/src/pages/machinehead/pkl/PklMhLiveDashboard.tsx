import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { apiClient } from '../../../lib/apiClient';
import type { ProcessQueueCard } from '../../../store/processStore';

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
          <input
            className="h-10 w-full max-w-sm rounded-lg border border-input bg-background px-3 text-sm"
            placeholder="Filter coil / mother / slit / grade"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="min-h-0 flex-1 overflow-auto grid grid-cols-1 gap-2 lg:grid-cols-2">
            {filtered.map((c) => (
              <div key={c.coilNo} className="rounded-xl border border-border bg-card px-4 py-3">
                <p className="font-mono font-bold tabular-nums">{c.coilNo}</p>
                <p className="mt-1 text-xs text-muted-foreground">{c.gradeCode ?? '—'} · {Number(c.weightMt ?? 0).toFixed(2)} MT · {c.status}</p>
              </div>
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
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Order Status</p>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-xl font-bold">{running.coilNo}</p>
                <p className="text-sm text-muted-foreground">{running.customerName} · {running.gradeCode}</p>
                <p className="text-xs font-mono mt-1">
                  {running.widthMm}×{running.thicknessMm} mm · {running.weightMt} MT
                </p>
              </div>
              <span className="text-[10px] uppercase font-bold px-2 py-1 rounded bg-success/15 text-success">{running.status}</span>
            </div>
            <button
              type="button"
              className="mt-3 text-sm text-primary underline"
              onClick={() => navigate(`/machine-head/pkl/coil/${encodeURIComponent(running.coilNo)}`)}
            >
              Open coil detail
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">No coil in progress</div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {([1, 2, 3] as const).map((tn) => {
            const r = latestByTank[tn];
            return (
              <button
                key={tn}
                type="button"
                onClick={() => setDrillTank(tn)}
                className="rounded-xl border border-border bg-card p-4 text-left hover:border-primary/40"
              >
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Tank T{tn}</p>
                {r ? (
                  <dl className="mt-2 grid grid-cols-2 gap-1 text-xs font-mono">
                    <dt className="text-muted-foreground">Level</dt><dd>{s(r.tank_level)}</dd>
                    <dt className="text-muted-foreground">Temp</dt><dd>{s(r.tank_temp_degc)}</dd>
                    <dt className="text-muted-foreground">Acid%</dt><dd>{s(r.acid_strength_pct)}</dd>
                    <dt className="text-muted-foreground">Iron%</dt><dd>{s(r.iron_strength_pct)}</dd>
                  </dl>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No reading</p>
                )}
              </button>
            );
          })}
        </div>

        {trendData.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-4 h-64">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Tank temps</p>
            <ResponsiveContainer width="100%" height="90%">
              <AreaChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="time" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="t1Temp" name="T1 °C" stroke="#163328" fill="#16332833" />
                <Area type="monotone" dataKey="t2Temp" name="T2 °C" stroke="#3B82F6" fill="#3B82F633" />
                <Area type="monotone" dataKey="t3Temp" name="T3 °C" stroke="#F59E0B" fill="#F59E0B33" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Queue</p>
          <input
            className="mb-2 h-10 w-full max-w-sm rounded-lg border border-input bg-background px-3 text-sm"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {filtered.map((c) => (
              <button
                key={c.coilNo}
                type="button"
                className="rounded-xl border border-border bg-card px-4 py-3 text-left hover:bg-muted"
                onClick={() => navigate(`/machine-head/pkl/coil/${encodeURIComponent(c.coilNo)}`)}
              >
                <p className="font-mono font-bold tabular-nums">{c.coilNo}</p>
                <p className="mt-1 text-xs text-muted-foreground">{c.gradeCode ?? '—'} · {Number(c.weightMt ?? 0).toFixed(2)} MT · {c.status}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {drillTank != null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-background rounded-xl p-6 w-full max-w-md space-y-3 max-h-[80vh] overflow-y-auto">
            <h3 className="font-bold">Tank T{drillTank} readings</h3>
            {chartRows.filter((r) => Number(r.tank_no) === drillTank).map((r) => (
              <div key={`${r.chart_time}-${r.tank_no}`} className="border border-border rounded-lg p-3 text-sm font-mono">
                <p className="font-bold mb-1">{r.chart_time}</p>
                <p>Level {s(r.tank_level)} · Temp {s(r.tank_temp_degc)} · Acid {s(r.acid_strength_pct)} · Iron {s(r.iron_strength_pct)}</p>
              </div>
            ))}
            {chartRows.filter((r) => Number(r.tank_no) === drillTank).length === 0 && (
              <p className="text-muted-foreground text-sm">No readings</p>
            )}
            <button type="button" className="text-sm text-primary" onClick={() => setDrillTank(null)}>Close</button>
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
