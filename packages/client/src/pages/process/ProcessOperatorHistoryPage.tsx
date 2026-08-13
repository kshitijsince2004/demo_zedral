import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { AnnOperatorHistoryPage } from './AnnOperatorHistoryPage';
import { CrmOperatorHistoryPage } from '../sixHi/CrmOperatorHistoryPage';
import { ZButton } from '../../components/primitives/ZButton';
import { ZInput } from '../../components/primitives/ZInput';
import { ZFilterPills } from '../../components/ui/operator/ZFilterPills';
import { apiClient } from '../../lib/apiClient';
import { useAuthStore } from '../../lib/authStore';
import { currentPlantDate } from '../../lib/dateFormat';
import { useShiftStore } from '../../store/shiftStore';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { isCrmMillCode } from '../../lib/millConfig';
import { isProcessStationCode } from '../../lib/processConfig';

type StatusFilter = 'COMPLETED' | 'HOLD';

const STATUS_PILLS: { id: StatusFilter; label: string }[] = [
  { id: 'COMPLETED', label: 'Completed' },
  { id: 'HOLD', label: 'Order Hold' },
];

function matchesStatus(status: unknown, filter: StatusFilter): boolean {
  const s = String(status ?? '').toUpperCase();
  if (filter === 'HOLD') return s === 'HOLD' || s === 'REJECTED';
  // Completed: treat blank/legacy rows as completed production entries too.
  return s === '' || s === 'COMPLETED' || s === 'DONE';
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
  const isProcess = isProcessStationCode(processCode);
  const isCrm = isCrmMillCode(processCode);
  const code = processCode.toLowerCase();
  const [historyDate, setHistoryDate] = useState(currentPlantDate());

  const load = useCallback(async () => {
    if (isAnn || !isProcess) return;
    if (!isHrs && !shiftLogId) return;
    setLoading(true);
    setError(null);
    try {
      if (isHrs) {
        const qs = new URLSearchParams({ shiftDate: historyDate, line: 'HRS' });
        const logs = await apiClient.get<Array<{ id: string }>>(`/shift-logs?${qs.toString()}`);
        const packs = await Promise.all(
          logs.map((log) =>
            apiClient
              .get<{ orders: Array<Record<string, unknown>> }>(
                `/stations/hrs/history?shiftLogId=${encodeURIComponent(log.id)}`,
              )
              .catch(() => ({ orders: [] as Array<Record<string, unknown>> })),
          ),
        );
        const seen = new Set<string>();
        const merged: Array<Record<string, unknown>> = [];
        for (const pack of packs) {
          for (const row of pack.orders ?? []) {
            const key = String(row.id ?? row.coilNo ?? '');
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(row);
          }
        }
        setOrders(merged);
      } else {
        const o = await apiClient.get<{ orders: Array<Record<string, unknown>> }>(
          `/stations/${code}/history?shiftLogId=${encodeURIComponent(shiftLogId!)}`,
        );
        setOrders(o.orders ?? []);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [shiftLogId, code, isAnn, isProcess, isHrs, historyDate]);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    return orders.filter((row) => {
      if (!matchesStatus(row.status, statusFilter)) return false;
      if (!q) return true;
      const hay = [row.coilNo, row.gradeCode, row.surfaceFinish]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
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
        {isHrs && (
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
        {!isHrs && !shiftLogId && <p className="text-sm text-muted-foreground">No active shift log.</p>}
        {error && <p className="text-sm text-destructive mb-2">{error}</p>}
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!loading && (
          <div className="rounded-lg border border-border bg-background overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-muted-foreground border-b border-border bg-card">
                <th className="py-2 px-2 font-medium">Coil</th>
                <th className="py-2 px-2 font-medium">Grade / Finish</th>
                <th className="py-2 px-2 font-medium">Weight MT</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const grade = row.gradeCode ? String(row.gradeCode) : '';
                const finish = row.surfaceFinish ? String(row.surfaceFinish) : '';
                const gradeFinish = [grade, finish].filter(Boolean).join(' / ') || '—';
                return (
                <tr key={String(row.id)} className="border-b border-border/50 font-mono">
                  <td className="py-2 px-2 font-bold">{String(row.coilNo ?? '—')}</td>
                  <td className="py-2 px-2">{gradeFinish}</td>
                  <td className="py-2 px-2">{row.weightMt != null ? Number(row.weightMt).toFixed(2) : '—'}</td>
                </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={3} className="py-6 px-2 text-muted-foreground">No {statusFilter === 'HOLD' ? 'held' : 'completed'} orders {isHrs ? 'for this date' : 'this shift'}</td></tr>
              )}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
