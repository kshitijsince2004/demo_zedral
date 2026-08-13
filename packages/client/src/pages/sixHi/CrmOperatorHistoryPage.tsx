import { useCallback, useEffect, useMemo, useState } from 'react';
import { ZButton } from '../../components/primitives/ZButton';
import { ZFilterPills } from '../../components/ui/operator/ZFilterPills';
import { apiClient } from '../../lib/apiClient';
import { useAuthStore } from '../../lib/authStore';
import { currentPlantDate, formatPlantDate, formatPlantDateTime } from '../../lib/dateFormat';
import { formatOrderProcessLabel, formatProcessFilterLabel } from '../../lib/orderLabels';
import { asDisplayText } from '../../lib/sixHiOrderIdentity';
import { isCrmMillCode } from '../../lib/millConfig';
import {
  listManualRerollSessions,
  type ManualRerollSession,
} from '../../services/manualRerollService';

type HistoryProcessFilter = 'ALL' | 'ROLLING' | 'SKIN_PASS' | 'MANUAL_REROLL';

type HistoryRow = {
  kind: 'CRM' | 'MANUAL_REROLL';
  key: string;
  batchNumber: string;
  machineCode: string;
  customer?: string;
  weightMt?: number;
  prodEndAt?: string;
  subProcess: string;
};

const FILTERS: HistoryProcessFilter[] = ['ALL', 'ROLLING', 'SKIN_PASS', 'MANUAL_REROLL'];

function sessionPlantDate(s: ManualRerollSession): string {
  return formatPlantDate(s.endTime ?? s.startTime);
}

/** CRM mill operator History — completed Rolling / Skin Pass / Manual Re-Rolling. */
export function CrmOperatorHistoryPage() {
  const activeMachine = (useAuthStore((s) => s.activeMachine) ?? '').toUpperCase();
  const machine = isCrmMillCode(activeMachine) ? activeMachine : '';
  const [filter, setFilter] = useState<HistoryProcessFilter>('ALL');
  const [date, setDate] = useState(currentPlantDate());
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!machine) return;
    setLoading(true);
    setError(null);
    try {
      const wantCrm = filter === 'ALL' || filter === 'ROLLING' || filter === 'SKIN_PASS';
      const wantReroll = filter === 'ALL' || filter === 'MANUAL_REROLL';
      const out: HistoryRow[] = [];

      if (wantCrm) {
        const qs = new URLSearchParams({ machine, date });
        const raw = await apiClient.get<unknown>(`/6hi/orders/completed?${qs.toString()}`);
        const res = Array.isArray(raw)
          ? raw
          : (raw && typeof raw === 'object' && Array.isArray((raw as { orders?: unknown }).orders)
            ? (raw as { orders: Array<Record<string, unknown>> }).orders
            : []);
        for (const o of res) {
          const rec = o as Record<string, unknown>;
          const subRaw = asDisplayText(rec.subProcess ?? rec.sub_process);
          const sub = subRaw === 'SKIN_PASS' ? 'SKIN_PASS' : 'ROLLING';
          if (filter === 'ROLLING' && sub !== 'ROLLING') continue;
          if (filter === 'SKIN_PASS' && sub !== 'SKIN_PASS') continue;
          const batchNumber = asDisplayText(rec.batchNumber ?? rec.batch_number);
          if (!batchNumber) continue;
          const weightRaw = rec.weightMt ?? rec.weight_mt ?? rec.ppc_weight_mt;
          out.push({
            kind: 'CRM',
            key: `crm-${batchNumber}`,
            batchNumber,
            machineCode: asDisplayText(rec.machineCode ?? rec.machine_code) || machine,
            customer: asDisplayText(rec.customer ?? rec.customer_name) || undefined,
            weightMt: weightRaw != null && weightRaw !== '' ? Number(weightRaw) : undefined,
            prodEndAt: asDisplayText(rec.prodEndAt ?? rec.prod_end_at) || undefined,
            subProcess: sub,
          });
        }
      }

      if (wantReroll) {
        const pack = await listManualRerollSessions(machine).catch(() => ({ sessions: [] as ManualRerollSession[] }));
        for (const s of pack.sessions) {
          if (s.status !== 'COMPLETED') continue;
          if (date && sessionPlantDate(s) !== date) continue;
          const batches = (s.batchNumbers?.length ? s.batchNumbers : s.batchNumber ? [s.batchNumber] : [])
            .filter(Boolean) as string[];
          out.push({
            kind: 'MANUAL_REROLL',
            key: `mr-${s.sessionId}`,
            batchNumber: batches.length > 1 ? batches.join(' · ') : (batches[0] ?? s.sessionId),
            machineCode: s.machineCode,
            weightMt: s.rerollQuantity != null ? Number(s.rerollQuantity) : undefined,
            prodEndAt: s.endTime ?? undefined,
            subProcess: 'MANUAL_REROLL',
          });
        }
      }

      out.sort((a, b) => String(b.prodEndAt ?? '').localeCompare(String(a.prodEndAt ?? '')));
      setRows(out);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [machine, filter, date]);

  useEffect(() => { void load(); }, [load]);

  const pillOptions = useMemo(
    () => FILTERS.map((id) => ({ id, label: formatProcessFilterLabel(id) })),
    [],
  );

  if (!machine) {
    return <p className="p-4 text-sm text-muted-foreground">Select a CRM mill (6HI / 4HI / 2HI) to view history.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border bg-card px-4 py-3 flex flex-wrap items-center gap-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">History</p>
          <h1 className="text-lg font-bold text-foreground">{machine} · Completed</h1>
        </div>
        <label className="text-xs font-medium text-muted-foreground">
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 ml-2 rounded-lg border border-border bg-white px-2 py-1 text-sm font-mono tabular-nums"
          />
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <ZFilterPills options={pillOptions} activeId={filter} onChange={setFilter} />
          <ZButton type="button" variant="secondary" size="sm" className="!h-10 !min-h-10" onClick={() => void load()}>
            Refresh
          </ZButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4">
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {loading && rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading history…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No completed history for this filter.</p>
        ) : (
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Order</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Process</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Customer</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Weight</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">Completed</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-3 py-2 font-mono font-bold">{r.batchNumber}</td>
                  <td className="px-3 py-2 font-medium">
                    {r.subProcess === 'MANUAL_REROLL'
                      ? formatProcessFilterLabel('MANUAL_REROLL')
                      : formatOrderProcessLabel(r.subProcess)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{r.customer ?? '—'}</td>
                  <td className="px-3 py-2 font-mono tabular-nums">
                    {r.weightMt != null ? `${r.weightMt} MT` : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono tabular-nums text-muted-foreground">
                    {r.prodEndAt ? formatPlantDateTime(r.prodEndAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
