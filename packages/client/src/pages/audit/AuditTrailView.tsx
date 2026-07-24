import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { auditService, type AuditRecord } from '../../services/auditService';
import { currentPlantDate, formatPlantDateTime } from '../../lib/dateFormat';
import { ZInput } from '../../components/primitives/ZInput';
import { ZButton } from '../../components/primitives/ZButton';

/** Render stored audit values as plain text (not raw JSON). */
function formatAuditValue(value: string | null): string {
  if (value == null || value === '') return '—';
  const trimmed = value.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return value;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed === null || typeof parsed !== 'object') {
      return String(parsed);
    }
    if (Array.isArray(parsed)) {
      return parsed.length === 0
        ? '—'
        : parsed.map((item, i) => `${i + 1}. ${formatPlainLeaf(item)}`).join('\n');
    }
    const lines = Object.entries(parsed as Record<string, unknown>)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}: ${formatPlainLeaf(v)}`);
    return lines.length > 0 ? lines.join('\n') : '—';
  } catch {
    return value;
  }
}

function formatPlainLeaf(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const ACTION_OPTIONS = ['', 'INSERT', 'UPDATE', 'DELETE'] as const;
const PAGE_SIZE = 50;

/**
 * Audit trail browser for Plant Head and Admin (read-only).
 * Search + filters: free text, action, table, user, date range.
 */
export function AuditTrailView() {
  const today = currentPlantDate();
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [q, setQ] = useState('');
  const [action, setAction] = useState('');
  const [tableName, setTableName] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState(today);

  const [applied, setApplied] = useState({
    q: '',
    action: '',
    tableName: '',
    userId: '',
    from: '',
    to: today,
  });

  const load = useCallback(async (pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const userIdNum = applied.userId.trim() ? Number(applied.userId) : undefined;
      const result = await auditService.query({
        page: pageNum,
        pageSize: PAGE_SIZE,
        q: applied.q.trim() || undefined,
        action: applied.action || undefined,
        tableName: applied.tableName.trim() || undefined,
        userId: userIdNum != null && Number.isFinite(userIdNum) ? userIdNum : undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
      });
      setRecords(result.records);
      setTotal(result.total);
      setPage(result.page);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to load audit trail');
      setRecords([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [applied]);

  useEffect(() => {
    void load(1);
  }, [load]);

  const applyFilters = (e?: React.FormEvent) => {
    e?.preventDefault();
    setApplied({ q, action, tableName, userId, from, to });
  };

  const clearFilters = () => {
    setQ('');
    setAction('');
    setTableName('');
    setUserId('');
    setFrom('');
    setTo(today);
    setApplied({ q: '', action: '', tableName: '', userId: '', from: '', to: today });
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4 w-full max-w-6xl mx-auto">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Audit Trail</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Platform activity and change history · Plant Head &amp; Admin (read-only)
        </p>
      </div>

      <form
        onSubmit={applyFilters}
        className="rounded-xl border border-border bg-card p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
      >
        <div className="sm:col-span-2 lg:col-span-3">
          <label className="text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground">
            Search
          </label>
          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Table, record id, field, or value…"
              className="h-11 w-full rounded-sm border border-input bg-background pl-9 pr-3 text-sm"
            />
          </div>
        </div>

        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground">
          Action
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="h-11 rounded-sm border border-input bg-background px-3 text-sm font-sans normal-case tracking-normal text-foreground"
          >
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt || 'all'} value={opt}>
                {opt || 'All actions'}
              </option>
            ))}
          </select>
        </label>

        <ZInput
          label="Table"
          value={tableName}
          onChange={(e) => setTableName(e.target.value)}
          placeholder="e.g. crm_order"
          mono={false}
        />

        <ZInput
          label="User ID"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="Numeric user id"
          inputMode="numeric"
        />

        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground">
          From date
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-11 rounded-sm border border-input bg-background px-3 text-sm font-mono text-foreground normal-case tracking-normal"
          />
        </label>

        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-[0.14em] font-medium text-muted-foreground">
          To date
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-11 rounded-sm border border-input bg-background px-3 text-sm font-mono text-foreground normal-case tracking-normal"
          />
        </label>

        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-1">
          <ZButton type="submit" variant="accent" className="flex-1 min-h-11">
            Apply
          </ZButton>
          <ZButton type="button" variant="ghost" className="min-h-11" onClick={clearFilters}>
            Clear
          </ZButton>
        </div>
      </form>

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {loading ? 'Loading…' : `${total} record${total === 1 ? '' : 's'}`}
          {!loading && total > 0 ? ` · page ${page} of ${totalPages}` : ''}
        </span>
        <div className="flex gap-2">
          <ZButton
            type="button"
            variant="ghost"
            className="min-h-9"
            disabled={loading || page <= 1}
            onClick={() => void load(page - 1)}
          >
            Previous
          </ZButton>
          <ZButton
            type="button"
            variant="ghost"
            className="min-h-9"
            disabled={loading || page >= totalPages}
            onClick={() => void load(page + 1)}
          >
            Next
          </ZButton>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!error && (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-secondary/60 text-left">
              <tr>
                <th className="px-3 py-2 font-semibold">Table</th>
                <th className="px-3 py-2 font-semibold">Record</th>
                <th className="px-3 py-2 font-semibold">Action</th>
                <th className="px-3 py-2 font-semibold">Field</th>
                <th className="px-3 py-2 font-semibold">Old</th>
                <th className="px-3 py-2 font-semibold">New</th>
                <th className="px-3 py-2 font-semibold">User</th>
                <th className="px-3 py-2 font-semibold">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {!loading && records.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                    No audit records match these filters.
                  </td>
                </tr>
              )}
              {records.map((row) => (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="px-3 py-2 whitespace-nowrap">{row.table_name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.record_id || '—'}</td>
                  <td className="px-3 py-2">{row.action}</td>
                  <td className="px-3 py-2">{row.field ?? '—'}</td>
                  <td className="px-3 py-2 text-xs max-w-[14rem] whitespace-pre-wrap break-words">
                    {formatAuditValue(row.old_value)}
                  </td>
                  <td className="px-3 py-2 text-xs max-w-[20rem] whitespace-pre-wrap break-words">
                    {formatAuditValue(row.new_value)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{row.user_id ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{formatPlantDateTime(row.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
