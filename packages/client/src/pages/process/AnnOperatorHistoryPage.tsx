import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { apiClient } from '../../lib/apiClient';
import type { AnnBoardRow } from '../../components/process/bodies/AnnBaseCard';

type ReadingRow = {
  reading_id: string;
  taken_at: string;
  stage_code: string | null;
  charge_temp: number | string | null;
  gas_temp: number | string | null;
  fc_temp: number | string | null;
  base_press: number | string | null;
  base_fan_rpm: number | string | null;
  base_no: string;
  batch_no: string;
  charge_no: string;
};

/** Operator ANN History — tabular readings across open bases. */
export function AnnOperatorHistoryPage() {
  const [rows, setRows] = useState<ReadingRow[]>([]);
  const [baseNo, setBaseNo] = useState('');
  const [batchQ, setBatchQ] = useState('');
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    return d.toISOString().slice(0, 16);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [loading, setLoading] = useState(false);
  const [bases, setBases] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const board = await apiClient.get<{ board: AnnBoardRow[] }>('/stations/ann/board');
      const withCharge = (board.board ?? []).filter((r) => r.charge?.charge_no);
      setBases((board.board ?? []).map((b) => b.base_no));
      const fromMs = new Date(from).getTime();
      const toMs = new Date(to).getTime();
      const all: ReadingRow[] = [];
      await Promise.all(
        withCharge.map(async (row) => {
          const cn = row.charge!.charge_no;
          const d = await apiClient.get<{
            charge: Record<string, unknown>;
            readings: Array<{
              reading_id: string;
              taken_at: string;
              stage_code: string | null;
              charge_temp: number | string | null;
              gas_temp: number | string | null;
              fc_temp: number | string | null;
              base_press: number | string | null;
              base_fan_rpm: number | string | null;
            }>;
          }>(`/stations/ann/charges/${encodeURIComponent(cn)}`);
          for (const r of d.readings ?? []) {
            const ms = new Date(r.taken_at).getTime();
            if (ms < fromMs || ms > toMs) continue;
            all.push({
              ...r,
              base_no: row.base_no,
              batch_no: String(d.charge.annealing_batch_no ?? row.charge?.annealing_batch_no ?? '—'),
              charge_no: cn,
            });
          }
        }),
      );
      all.sort((a, b) => b.taken_at.localeCompare(a.taken_at));
      setRows(all);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = batchQ.trim().toLowerCase();
    return rows.filter((r) => {
      if (baseNo && r.base_no !== baseNo) return false;
      if (q && !r.batch_no.toLowerCase().includes(q) && !r.charge_no.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [baseNo, batchQ, rows]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-4">
      <h1 className="text-lg font-bold shrink-0 text-foreground">Reading history</h1>
      <div className="flex flex-wrap gap-2 items-end shrink-0">
        <label className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground flex flex-col gap-1">
          Base
          <select
            className="h-10 min-h-10 rounded-lg border border-input bg-background px-2 text-sm text-foreground"
            value={baseNo}
            onChange={(e) => setBaseNo(e.target.value)}
          >
            <option value="">All</option>
            {bases.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <div className="min-w-[10rem]">
          <ZInput
            label="Batch / charge"
            value={batchQ}
            onChange={(e) => setBatchQ(e.target.value)}
            placeholder="Search…"
            mono={false}
            className="!h-10 rounded-lg"
          />
        </div>
        <label className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground flex flex-col gap-1">
          From
          <input
            type="datetime-local"
            className="h-10 min-h-10 rounded-lg border border-input bg-background px-2 text-sm font-mono"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground flex flex-col gap-1">
          To
          <input
            type="datetime-local"
            className="h-10 min-h-10 rounded-lg border border-input bg-background px-2 text-sm font-mono"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <ZButton
          type="button"
          variant="primary"
          className="!h-10 !min-h-10 rounded-lg"
          onClick={() => void load()}
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          Refresh
        </ZButton>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-background">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <table className="w-full text-xs text-left">
            <thead className="sticky top-0 bg-card text-[10px] uppercase tracking-[0.14em] text-muted-foreground border-b border-border">
              <tr>
                <th className="p-2 font-medium">Taken</th>
                <th className="p-2 font-medium">Base</th>
                <th className="p-2 font-medium">Batch</th>
                <th className="p-2 font-medium">Charge</th>
                <th className="p-2 font-medium">Stage</th>
                <th className="p-2 font-medium">Charge °C</th>
                <th className="p-2 font-medium">Gas °C</th>
                <th className="p-2 font-medium">F/C °C</th>
                <th className="p-2 font-medium">Base Press</th>
                <th className="p-2 font-medium">Base Fan</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="p-6 text-center text-muted-foreground">No readings in range.</td></tr>
              )}
              {filtered.map((r) => (
                <tr key={r.reading_id} className="border-t border-border font-mono tabular-nums text-foreground">
                  <td className="p-2 whitespace-nowrap">{new Date(r.taken_at).toLocaleString('en-IN')}</td>
                  <td className="p-2">{r.base_no}</td>
                  <td className="p-2">{r.batch_no}</td>
                  <td className="p-2">{r.charge_no}</td>
                  <td className="p-2">{r.stage_code ?? '—'}</td>
                  <td className="p-2">{r.charge_temp ?? '—'}</td>
                  <td className="p-2">{r.gas_temp ?? '—'}</td>
                  <td className="p-2">{r.fc_temp ?? '—'}</td>
                  <td className="p-2">{r.base_press ?? '—'}</td>
                  <td className="p-2">{r.base_fan_rpm ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
