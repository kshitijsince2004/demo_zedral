import { useCallback, useEffect, useState } from 'react';
import { AdminPanel } from './AdminPanel';
import { ZButton } from '../primitives/ZButton';
import { shiftAdminService, type ShiftAuditEvent } from '../../lib/shiftAdminService';
import { formatPlantDateTime } from '../../lib/dateFormat';

export function ShiftAuditPanel() {
  const [events, setEvents] = useState<ShiftAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await shiftAdminService.getAudit({ limit: 30 });
      setEvents(res.events);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load audit');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <AdminPanel title="Shift event audit">
      <div className="px-4 py-2 border-b border-border flex justify-end">
        <ZButton variant="ghost" size="sm" onClick={load}>Refresh</ZButton>
      </div>
      {loading && <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="px-4 py-3 text-sm text-destructive">{error}</p>}
      {!loading && events.length === 0 && (
        <p className="px-4 py-6 text-sm text-muted-foreground text-center">No events recorded</p>
      )}
      {!loading && events.length > 0 && (
        <ul className="divide-y divide-border text-xs">
          {events.map((e) => (
            <li key={e.eventId} className="px-4 py-2 flex flex-col gap-0.5">
              <div className="flex justify-between gap-2">
                <span className="font-semibold">{e.eventType}</span>
                <span className="text-muted-foreground font-mono">
                  {formatPlantDateTime(e.createdAt)}
                </span>
              </div>
              <div className="text-muted-foreground">
                {[e.machineCode, e.username, e.entityId].filter(Boolean).join(' · ')}
              </div>
            </li>
          ))}
        </ul>
      )}
    </AdminPanel>
  );
}
