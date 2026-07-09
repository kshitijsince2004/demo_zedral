import { useCallback, useEffect, useState } from 'react';
import { Check, X, RotateCcw } from 'lucide-react';
import { apiClient } from '../../lib/apiClient';
import { ZButton } from '../../components/primitives/ZButton';
import { formatPlantDateTime } from '../../lib/dateFormat';

interface ShiftLogRow {
  id: string;
  shiftDate: string;
  shiftCode: string;
  processLine: string;
  submittedBy: string;
  submittedAt: string;
  state: string;
  entryCount: number;
  overrideCount: number;
}

export function PlantShiftReviewPage() {
  const [logs, setLogs] = useState<ShiftLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = await apiClient.get<ShiftLogRow[]>('/shift-logs?state=SUBMITTED');
      setLogs(rows);
      setError(null);
    } catch (err: unknown) {
      setError((err as Error)?.message ?? 'Failed to load shift logs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30_000);
    return () => clearInterval(id);
  }, [load]);

  const approve = async (id: string) => {
    setBusyId(id);
    try {
      await apiClient.put(`/shift-logs/${id}/approve`, {});
      await load();
    } catch (err: unknown) {
      alert((err as Error)?.message ?? 'Approve failed');
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id: string) => {
    if (!rejectNote.trim()) {
      alert('Rejection note is required');
      return;
    }
    setBusyId(id);
    try {
      await apiClient.put(`/shift-logs/${id}/reject`, { note: rejectNote.trim() });
      setRejectingId(null);
      setRejectNote('');
      await load();
    } catch (err: unknown) {
      alert((err as Error)?.message ?? 'Reject failed');
    } finally {
      setBusyId(null);
    }
  };

  const reopen = async (id: string) => {
    setBusyId(id);
    try {
      await apiClient.put(`/shift-logs/${id}/reopen`, {});
      await load();
    } catch (err: unknown) {
      alert((err as Error)?.message ?? 'Reopen failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div>
        <h1 className="text-lg font-bold text-foreground">Shift Review</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Approve or reject submitted shift logs. Former supervisor approval workflows are handled here.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && <p className="text-sm text-muted-foreground">Loading pending reviews…</p>}

      {!loading && logs.length === 0 && (
        <div className="rounded-2xl border border-border bg-white px-6 py-12 text-center text-sm text-muted-foreground">
          No shift logs awaiting review
        </div>
      )}

      <ul className="space-y-3">
        {logs.map((log) => (
          <li key={log.id} className="rounded-2xl border border-border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono font-bold text-foreground">
                  {log.processLine} · Shift {log.shiftCode}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {String(log.shiftDate).slice(0, 10)} · Submitted by {log.submittedBy}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {log.submittedAt ? formatPlantDateTime(log.submittedAt) : '—'}
                  {' · '}{log.entryCount} entries
                  {log.overrideCount > 0 ? ` · ${log.overrideCount} overrides` : ''}
                </p>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-warning bg-warning/10 px-2 py-1 rounded-lg">
                {log.state}
              </span>
            </div>

            {rejectingId === log.id ? (
              <div className="mt-4 space-y-2">
                <textarea
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="Rejection reason (required)"
                  className="w-full rounded-xl border border-border px-3 py-2 text-sm min-h-[80px]"
                />
                <div className="flex gap-2 justify-end">
                  <ZButton variant="outline" size="sm" onClick={() => { setRejectingId(null); setRejectNote(''); }}>
                    Cancel
                  </ZButton>
                  <ZButton variant="danger" size="sm" disabled={busyId === log.id} onClick={() => void reject(log.id)}>
                    Confirm Reject
                  </ZButton>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 mt-4 justify-end">
                <ZButton
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  disabled={busyId === log.id}
                  onClick={() => void reopen(log.id)}
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Reopen
                </ZButton>
                <ZButton
                  variant="outline"
                  size="sm"
                  className="gap-1 text-destructive border-destructive/30"
                  disabled={busyId === log.id}
                  onClick={() => setRejectingId(log.id)}
                >
                  <X className="w-3.5 h-3.5" /> Reject
                </ZButton>
                <ZButton
                  variant="primary"
                  size="sm"
                  className="gap-1"
                  disabled={busyId === log.id}
                  onClick={() => void approve(log.id)}
                >
                  <Check className="w-3.5 h-3.5" /> Approve
                </ZButton>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
