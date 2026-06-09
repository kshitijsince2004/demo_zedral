import { useEffect, useState } from 'react';
import { auditService, type AuditRecord } from '../../services/auditService';

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
    <div className="theme-operator min-h-screen bg-background p-4 md:p-5">
      <h1 className="text-lg font-semibold tracking-tight mb-4">Audit Trail</h1>
      {loading && <p className="text-sm text-muted-foreground">Loading audit records…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {!loading && !error && (
        <div className="overflow-x-auto rounded-xl border border-border">
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
                  <td className="px-3 py-2">{row.table_name}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.record_id}</td>
                  <td className="px-3 py-2">{row.action}</td>
                  <td className="px-3 py-2">{row.field ?? '—'}</td>
                  <td className="px-3 py-2">{row.old_value ?? '—'}</td>
                  <td className="px-3 py-2">{row.new_value ?? '—'}</td>
                  <td className="px-3 py-2">{new Date(row.timestamp).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
