import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { AnnOperatorHistoryPage } from './AnnOperatorHistoryPage';
import { CrmOperatorHistoryPage } from '../sixHi/CrmOperatorHistoryPage';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { ZFilterPills } from '../../components/ui/operator/ZFilterPills';
import { apiClient } from '../../lib/apiClient';
import { useAuthStore } from '../../lib/authStore';
import { currentPlantDate, formatPlantDateTime } from '../../lib/dateFormat';
import { useShiftStore } from '../../store/shiftStore';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { asDisplayText, displayMotherCoilId } from '../../lib/sixHiOrderIdentity';
import { formatOrderStatusLabel } from '../../lib/orderLabels';
import { isCrmMillCode } from '../../lib/millConfig';
import { isProcessStationCode } from '../../lib/processConfig';

function historyText(row: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const text = asDisplayText(row[k]);
    if (text) return text;
  }
  return '';
}

function asHistoryRows(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (raw && typeof raw === 'object' && Array.isArray((raw as { orders?: unknown }).orders)) {
    return (raw as { orders: Array<Record<string, unknown>> }).orders;
  }
  return [];
}

function asShiftLogs(raw: unknown): Array<{ id: string }> {
  if (Array.isArray(raw)) return raw as Array<{ id: string }>;
  if (raw && typeof raw === 'object' && Array.isArray((raw as { logs?: unknown }).logs)) {
    return (raw as { logs: Array<{ id: string }> }).logs;
  }
  return [];
}

function historyWeight(row: Record<string, unknown>): number | null {
  const raw = row.weightMt ?? row.weight_mt ?? row.motherCoilWeightMt ?? row.ppcWeightMt;
  if (raw == null || raw === '') return null;
  if (typeof raw === 'object') {
    const inner = asDisplayText(raw);
    const n = Number(inner);
    return Number.isFinite(n) ? n : null;
  }
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

type StatusFilter = 'COMPLETED' | 'HOLD';

const STATUS_PILLS: { id: StatusFilter; label: string }[] = [
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'HOLD', label: 'Order Hold' },
];

function matchesStatus(status: unknown, filter: StatusFilter): boolean {
  const s = asDisplayText(status).toUpperCase();
  if (filter === 'HOLD') return s === 'HOLD' || s === 'REJECTED';
  return s === 'COMPLETED' || s === 'DONE' || s === '';
}

/** Operator History for HRS/PKL/RWD — ANN readings; CRM mills use CrmOperatorHistoryPage. */
export function ProcessOperatorHistoryPage() {
  const processCode = (useAuthStore((s) => s.activeMachine) ?? '').toUpperCase();
  const shiftLogId = useShiftStore((s) => s.shiftLogId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('COMPLETED');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAnn = processCode === 'ANN';
  const isHrs = processCode === 'HRS';
  const isPkl = processCode === 'PKL';
  const isRwd = processCode === 'RWD';
  const isDatedHistory = isHrs || isPkl || isRwd;
  const isProcess = isProcessStationCode(processCode);
  const isCrm = isCrmMillCode(processCode);
  const code = processCode.toLowerCase();
  const [historyDate, setHistoryDate] = useState(currentPlantDate());

  const load = useCallback(async () => {
    if (isAnn || !isProcess) return;
    if (!isDatedHistory && !shiftLogId) return;
    setLoading(true);
    setError(null);
    try {
      if (isDatedHistory) {
        const qs = new URLSearchParams({ shiftDate: historyDate, line: processCode });
        const logs = asShiftLogs(await apiClient.get(`/shift-logs?${qs.toString()}`));
        const packs = await Promise.all(
          logs.map((log) =>
            apiClient
              .get<unknown>(`/stations/${code}/history?shiftLogId=${encodeURIComponent(log.id)}`)
              .catch(() => ({ orders: [] as Array<Record<string, unknown>> })),
          ),
        );
        const seen = new Set<string>();
        const merged: Array<Record<string, unknown>> = [];
        for (const pack of packs) {
          for (const row of asHistoryRows(pack)) {
            const key = historyText(row, 'id', 'coilNo', 'coil_no', 'batchNumber', 'batch_number');
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(row);
          }
        }
        setOrders(merged);
      } else {
        const o = await apiClient.get<unknown>(
          `/stations/${code}/history?shiftLogId=${encodeURIComponent(shiftLogId!)}`,
        );
        setOrders(asHistoryRows(o));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [shiftLogId, code, isAnn, isProcess, isDatedHistory, historyDate, processCode]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return orders.filter((row) => {
      if (!matchesStatus(row.status, statusFilter)) return false;
      if (!q) return true;
      const hay = [
        historyText(row, 'coilNo', 'coil_no', 'displayCoilNo'),
        historyText(row, 'gradeCode', 'grade_code'),
        historyText(row, 'surfaceFinish', 'surface_finish', 'rollFinish'),
        historyText(row, 'batchNumber', 'batch_number', 'sap_batch_number'),
        historyText(row, 'customerName', 'customer_name', 'customer'),
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [orders, statusFilter, debouncedSearch]);

  const pillOptions = useMemo(
    () => STATUS_PILLS.map((p) => ({
      ...p,
      count: orders.filter((row) => matchesStatus(row.status, p.id)).length,
    })),
    [orders],
  );

  if (isAnn) return <AnnOperatorHistoryPage />;
  if (isCrm) return <CrmOperatorHistoryPage />;
  if (!isProcess) {
    return <p className="p-4 text-sm text-muted-foreground">History is available on process lines and CRM mills only.</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border bg-card px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">History</p>
            <h1 className="text-lg font-bold text-foreground">{processCode} · Shift log</h1>
          </div>
          <ZButton
            type="button"
            variant="secondary"
            size="sm"
            className="!h-10 !min-h-10 ml-auto"
            onClick={() => void load()}
          >
            Refresh
          </ZButton>
        </div>
        {isDatedHistory && (
          <label className="text-xs font-medium text-muted-foreground">
            Date
            <input
              type="date"
              value={historyDate}
              onChange={(e) => setHistoryDate(e.target.value || currentPlantDate())}
              className="mt-1 ml-2 rounded-lg border border-border bg-white px-2 py-1 text-sm font-mono tabular-nums"
            />
          </label>
        )}
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <ZInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search coil, grade, finish…"
            className="pl-9 min-h-12"
          />
        </div>
        <div className="overflow-x-auto">
          <ZFilterPills
            options={pillOptions}
            activeId={statusFilter}
            onChange={(id) => setStatusFilter(id as StatusFilter)}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-4">
        {!isDatedHistory && !shiftLogId && <p className="text-sm text-muted-foreground">No active shift log.</p>}
        {error && <p className="text-sm text-destructive mb-2">{error}</p>}
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!loading && (
          <div className="rounded-lg border border-border bg-background overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground border-b border-border bg-card">
                <th className="py-2 px-2 font-medium">Coil / Order</th>
                <th className="py-2 px-2 font-medium">Grade / Finish</th>
                <th className="py-2 px-2 font-medium">Weight MT</th>
                <th className="py-2 px-2 font-medium">Status</th>
                <th className="py-2 px-2 font-medium">Completed</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const coil = displayMotherCoilId(row) || '—';
                const grade = historyText(row, 'gradeCode', 'grade_code');
                const finish = historyText(row, 'surfaceFinish', 'surface_finish', 'rollFinish');
                const gradeFinish = [grade, finish].filter(Boolean).join(' / ') || '—';
                const weight = historyWeight(row);
                const status = historyText(row, 'status') || 'COMPLETED';
                const ended = historyText(row, 'timeTo', 'time_to', 'prodEndAt', 'prod_end_at', 'held_at');
                const batch = historyText(row, 'batchNumber', 'batch_number', 'sap_batch_number');
                const key = historyText(row, 'id', 'coilNo', 'coil_no') || coil;
                return (
                <tr key={key} className="border-b border-border/50 font-mono">
                  <td className="py-2 px-2 font-bold">
                    {coil}
                    {batch ? <span className="block text-[11px] font-normal text-muted-foreground">Batch {batch}</span> : null}
                  </td>
                  <td className="py-2 px-2">{gradeFinish}</td>
                  <td className="py-2 px-2">{weight != null ? weight.toFixed(2) : '—'}</td>
                  <td className="py-2 px-2">{formatOrderStatusLabel(status)}</td>
                  <td className="py-2 px-2 text-muted-foreground">{ended ? formatPlantDateTime(ended) : '—'}</td>
                </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="py-6 px-2 text-muted-foreground">No {statusFilter === 'HOLD' ? 'held' : 'completed'} orders {isDatedHistory ? 'for this date' : 'this shift'}</td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
