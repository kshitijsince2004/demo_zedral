import { useEffect, useState } from 'react';
import { auditService, type AuditRecord } from '../../services/auditService';
import { formatPlantDateTime } from '../../lib/dateFormat';

function formatAuditValue(val: string | null) {
  if (!val) return '—';
  
  // Sometimes postgres or systems wrap json in parentheses e.g. '({"a":1})'
  let parseable = val;
  if (parseable.startsWith('(') && parseable.endsWith(')')) {
    parseable = parseable.slice(1, -1);
  }

  try {
    const parsed = JSON.parse(parseable);
    if (typeof parsed === 'object' && parsed !== null) {
      return (
        <pre className="whitespace-pre-wrap text-[10px] bg-secondary/30 p-2 rounded max-w-xs overflow-x-auto break-all">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      );
    }
  } catch {
    // If it's not JSON, just return the raw value
  }
  return val;
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
              {records.map((row) => (
                <tr key={row.id} className="border-t border-border">
                  <td className="px-3 py-2 align-top">{row.table_name}</td>
                  <td className="px-3 py-2 font-mono text-xs align-top">{row.record_id}</td>
                  <td className="px-3 py-2 align-top">{row.action}</td>
                  <td className="px-3 py-2 align-top">{row.field ?? '—'}</td>
                  <td className="px-3 py-2 align-top">{formatAuditValue(row.old_value)}</td>
                  <td className="px-3 py-2 align-top">{formatAuditValue(row.new_value)}</td>
                  <td className="px-3 py-2 align-top whitespace-nowrap">{formatPlantDateTime(row.timestamp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
