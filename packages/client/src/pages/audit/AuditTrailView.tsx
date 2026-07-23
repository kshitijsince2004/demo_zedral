import { useEffect, useState } from 'react';
import { auditService, type AuditRecord } from '../../services/auditService';
import { formatPlantDateTime } from '../../lib/dateFormat';

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

export function AuditTrailView() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await auditService.query({ page: 1, pageSize: 50 });
        if (active) setRecords(result.records);
      } catch (err) {
        if (active) setError((err as Error).message ?? 'Failed to load audit trail');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-4 w-full max-w-6xl mx-auto">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Audit Trail</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Platform activity and change history</p>
      </div>
      {loading && <p className="text-sm text-muted-foreground">Loading audit records…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && (
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
                <th className="px-3 py-2 font-semibold">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    No audit records in the selected window.
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
