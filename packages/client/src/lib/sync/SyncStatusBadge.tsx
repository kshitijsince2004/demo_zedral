import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { authApi } from '../authApi';
import { useSyncStatus } from './syncStatusStore';
import * as outbox from './outboxRepo';

export function SyncStatusBadge() {
  const { isSyncing, pending, parked } = useSyncStatus();
  const [open, setOpen] = useState(false);
  const [parkedRows, setParkedRows] = useState<outbox.OutboxAction[]>([]);
  const [pin, setPin] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      const { syncNow } = await import('./engine');
      await syncNow('attention-open');
      setParkedRows(await outbox.parkedActions());
    })();
  }, [open, parked]);

  const color = parked > 0
    ? 'border-destructive/50 bg-destructive text-destructive-foreground'
    : pending > 0
      ? 'border-amber-400/50 bg-amber-500 text-amber-950'
      : 'border-emerald-500/40 bg-emerald-600 text-white';
  const label = parked > 0 ? 'attention' : pending > 0 ? `${pending} pending` : 'synced';

  const handleDiscard = async () => {
    if (!selectedId) return;
    setError(null);
    try {
      await authApi.supervisorOverride(pin, 'Discard parked sync action');
      await outbox.discardParked(selectedId);
      const counts = await outbox.counts();
      const pendingByAggregate = await outbox.pendingByAggregate();
      useSyncStatus.getState().set({ ...counts, pendingByAggregate });
      setPin('');
      setSelectedId(null);
      setParkedRows(await outbox.parkedActions());
    } catch {
      setError('Supervisor PIN failed or network is unavailable.');
    }
  };

  const handleClearResolved = async () => {
    setError(null);
    try {
      const { syncNow } = await import('./engine');
      await syncNow('clear-resolved');
      const { isBenignSyncClientError } = await import('./outboxPolicy');
      await outbox.reconcileBenignParked(isBenignSyncClientError);
      const counts = await outbox.counts();
      const pendingByAggregate = await outbox.pendingByAggregate();
      useSyncStatus.getState().set({ ...counts, pendingByAggregate });
      setParkedRows(await outbox.parkedActions());
    } catch {
      setError('Could not clear resolved duplicates. Try again when online.');
    }
  };

  return (
    <>
      <button
        type="button"
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${color}`}
        onClick={() => parked > 0 && setOpen(true)}
        aria-label={`Sync status: ${label}`}
      >
        {isSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : parked > 0 ? <AlertTriangle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
        <span>{isSyncing && pending === 0 && parked === 0 ? 'syncing' : label}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">Sync Attention Required</h2>
                <p className="text-sm text-muted-foreground">Parked actions need supervisor review before this line can continue syncing that sequence.</p>
              </div>
              <button type="button" className="text-sm text-muted-foreground underline" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            <div className="max-h-72 space-y-3 overflow-y-auto">
              {parkedRows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className={`w-full rounded-lg border p-3 text-left text-sm ${selectedId === row.id ? 'border-accent bg-accent/10' : 'border-border bg-secondary/40'}`}
                  onClick={() => setSelectedId(row.id)}
                >
                  <div className="font-semibold text-foreground">{row.method} {row.url}</div>
                  <div className="text-xs text-muted-foreground">Aggregate {row.aggregateKey}, seq {row.seq}, attempts {row.attempts}</div>
                  {row.lastError && <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded bg-background p-2 text-xs text-muted-foreground">{row.lastError}</pre>}
                </button>
              ))}
              {parkedRows.length === 0 && <p className="text-sm text-muted-foreground">No parked actions.</p>}
            </div>

            {parkedRows.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  className="text-sm font-semibold text-foreground underline"
                  onClick={() => void handleClearResolved()}
                >
                  Clear resolved duplicates
                </button>
                <p className="mt-1 text-xs text-muted-foreground">
                  Replays parked rows that the server now treats as already applied. No PIN required.
                </p>
              </div>
            )}

            {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

            {selectedId && (
              <div className="mt-4 flex flex-col gap-2 border-t border-border pt-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="supervisor-pin">
                  Supervisor PIN to discard selected action
                </label>
                <div className="flex gap-2">
                  <input
                    id="supervisor-pin"
                    type="password"
                    className="min-h-11 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                    value={pin}
                    onChange={(event) => setPin(event.target.value)}
                  />
                  <button
                    type="button"
                    className="rounded-md bg-destructive px-4 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
                    disabled={pin.length < 4}
                    onClick={() => void handleDiscard()}
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
