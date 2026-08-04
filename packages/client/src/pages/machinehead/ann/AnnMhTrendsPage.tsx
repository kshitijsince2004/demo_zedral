import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChevronLeft } from 'lucide-react';
import { MachineHeadShell } from '../../../components/layout/machinehead/MachineHeadShell';
import { ZButton } from '../../../components/primitives/ZButton';
import { apiClient } from '../../../lib/apiClient';
import type { AnnBoardRow } from '../../../components/process/bodies/AnnBaseCard';

type Reading = {
  reading_id: string;
  taken_at: string;
  charge_temp: number | string | null;
  gas_temp: number | string | null;
  fc_temp: number | string | null;
  base_press: number | string | null;
  base_fan_rpm: number | string | null;
  n2h2_flow: number | string | null;
  fuel_flow: number | string | null;
};

type MetricKey = 'charge_temp' | 'gas_temp' | 'fc_temp' | 'base_press' | 'base_fan_rpm' | 'n2h2_flow' | 'fuel_flow';

const METRICS: { key: MetricKey; label: string }[] = [
  { key: 'charge_temp', label: 'Charge temp' },
  { key: 'gas_temp', label: 'Gas temp' },
  { key: 'fc_temp', label: 'F/C temp' },
  { key: 'base_press', label: 'Base pressure' },
  { key: 'base_fan_rpm', label: 'Base fan RPM' },
  { key: 'n2h2_flow', label: 'N₂/H₂ flow' },
  { key: 'fuel_flow', label: 'Fuel flow' },
];

function num(v: number | string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Multi-metric trends — base + search filters. */
export function AnnMhTrendsPage() {
  const navigate = useNavigate();
  const [board, setBoard] = useState<AnnBoardRow[]>([]);
  const [baseNo, setBaseNo] = useState('');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 16);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [byBase, setByBase] = useState<Record<string, Reading[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void apiClient.get<{ board: AnnBoardRow[] }>('/stations/ann/board').then((b) => setBoard(b.board ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const fromMs = new Date(from).getTime();
      const toMs = new Date(to).getTime();
      const q = search.trim().toLowerCase();
      let targets = board.filter((r) => r.charge?.charge_no);
      if (baseNo) targets = targets.filter((r) => r.base_no === baseNo);
      if (q) {
        const matched: AnnBoardRow[] = [];
        for (const row of targets) {
          const batch = (row.charge?.annealing_batch_no ?? '').toLowerCase();
          const cn = (row.charge?.charge_no ?? '').toLowerCase();
          if (batch.includes(q) || cn.includes(q) || row.base_no.toLowerCase().includes(q)) {
            matched.push(row);
            continue;
          }
          const d = await apiClient.get<{ roster: { coil_no: string }[] }>(
            `/stations/ann/charges/${encodeURIComponent(row.charge!.charge_no)}`,
          );
          if ((d.roster ?? []).some((c) => c.coil_no.toLowerCase().includes(q))) matched.push(row);
        }
        targets = matched;
      }
      const next: Record<string, Reading[]> = {};
      await Promise.all(
        targets.map(async (row) => {
          const d = await apiClient.get<{ readings: Reading[] }>(
            `/stations/ann/charges/${encodeURIComponent(row.charge!.charge_no)}`,
          );
          next[row.base_no] = (d.readings ?? []).filter((r) => {
            const ms = new Date(r.taken_at).getTime();
            return ms >= fromMs && ms <= toMs;
          });
        }),
      );
      setByBase(next);
    } finally {
      setLoading(false);
    }
  }, [baseNo, board, from, search, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const colors = [
    'var(--color-chart-1)',
    'var(--color-chart-2)',
    'var(--color-chart-3)',
    'var(--color-chart-4)',
    'var(--color-chart-5)',
    'var(--color-primary)',
  ];
  const baseKeys = Object.keys(byBase);

  function chartData(metric: MetricKey) {
    const map = new Map<string, Record<string, string | number>>();
    for (const [base, pts] of Object.entries(byBase)) {
      for (const p of pts) {
        const v = num(p[metric]);
        if (v == null) continue;
        const label = new Date(p.taken_at).toLocaleString('en-IN', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        const row = map.get(p.taken_at) ?? { t: label };
        row[base] = v;
        map.set(p.taken_at, row);
      }
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v);
  }

  return (
    <MachineHeadShell
      title="ANN Trends"
      subtitle="All metrics by base"
      onRefresh={() => void load()}
      headerActions={
        <ZButton variant="secondary" size="sm" onClick={() => navigate('/machine-head/ann/live')}>
          <ChevronLeft className="h-4 w-4" /> Live
        </ZButton>
      }
    >
      <div className="flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Base
          <select className="h-10 min-h-10 rounded-lg border border-input bg-background px-3 text-sm" value={baseNo} onChange={(e) => setBaseNo(e.target.value)}>
            <option value="">All open bases</option>
            {board.map((b) => <option key={b.base_no} value={b.base_no}>{b.base_no}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Search (batch / coil / charge)
          <input className="h-10 min-h-10 rounded-lg border border-input bg-background px-3 text-sm min-w-[14rem] font-mono" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ANN batch or coil…" />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          From
          <input type="datetime-local" className="h-10 min-h-10 rounded-lg border border-input bg-background px-3 text-sm font-mono" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          To
          <input type="datetime-local" className="h-10 min-h-10 rounded-lg border border-input bg-background px-3 text-sm font-mono" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground p-4">Loading…</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {METRICS.map((m) => {
            const data = chartData(m.key);
            return (
              <div key={m.key} className="rounded-lg border border-border bg-card h-56 p-2 shadow-sm">
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground px-2">{m.label}</p>
                {data.length === 0 ? (
                  <p className="text-xs text-muted-foreground p-4">No data</p>
                ) : (
                  <ResponsiveContainer width="100%" height="90%">
                    <LineChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="t" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 9 }} />
                      <Tooltip />
                      <Legend />
                      {baseKeys.map((b, i) => (
                        <Line key={b} type="monotone" dataKey={b} stroke={colors[i % colors.length]} dot={false} strokeWidth={2} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            );
          })}
        </div>
      )}
    </MachineHeadShell>
  );
}
